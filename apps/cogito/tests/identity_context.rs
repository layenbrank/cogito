//! 请求身份上下文（`guards::session`）与身份读模型（`identity::persistence`）的端到端验证。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）且连接账号为超级用户：
//!
//! ```text
//! TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cogito_service_test cargo test --test identity_context
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 断言的核心是「库是权威」：令牌里的角色声明不能提权，账号停用/不存在立即失效，
//! 库中出现无法识别的字面量时直接失败而不是降级。身份读取跑在非属主角色上，
//! 与 `tenant_isolation.rs` 一样受行级安全约束。

use std::sync::LazyLock;
use std::time::Duration;

use actix_web::http::StatusCode;
use authz::{Action, Decision, DenyReason, Permission, Resource};
use identity::{PersistError, PlatformRole, TenantId, TenantRole, UserId, persistence};
use migration::MigratorTrait;
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection};
use cogito::databases::database::Storage;
use cogito::guards::session::{Session, SessionError};
use cogito::guards::tenant::TenantCtx;
use cogito::utils::code::auth;
use cogito::utils::jwt::Claims;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 身份读取必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE，但角色侧也要对）。
const APP_ROLE: &str = "cogito_app_test";

/// 远超测试生命周期的过期时间（2100-01-01），避免用例受系统时钟影响。
const FAR_FUTURE_EXP: i64 = 4_102_444_800;

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    /// 超级用户连接：种数据、对照 RLS 之前的原始形态。
    admin: DatabaseConnection,
    /// 应用连接（非属主角色）：`Session::resolve` / `persistence` 的输入。
    storage: Storage,
    tenant_a: Uuid,
    tenant_b: Uuid,
    /// 库中平台角色为 `ADMIN`、状态 `ACTIVE`。
    platform_admin: UserId,
    /// 库中平台角色为 `USER`、状态 `ACTIVE`；`tenant_a` 的 `OWNER`，`tenant_b` 的成员已停用。
    member: UserId,
    /// 库中状态为 `DISABLED`。
    disabled: UserId,
    /// 库中平台角色是 `SUPERUSER` 这种无法识别的字面量。
    legacy_role: UserId,
}

/// 读取测试库地址；未配置或库名不合法时返回 `None`（调用方直接跳过）。
fn test_database_url() -> Option<String> {
    let uri = std::env::var("TEST_DATABASE_URL").ok()?;
    let uri = uri.trim().to_owned();
    if uri.is_empty() {
        return None;
    }
    let database = database_of(&uri);
    assert!(
        database.contains("test"),
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）：用例会重建库"
    );
    Some(uri)
}

fn database_of(uri: &str) -> String {
    let tail = uri.rsplit('/').next().unwrap_or_default();

    tail.split('?').next().unwrap_or_default().to_owned()
}

/// 把测试库 URI 的账号换成应用角色，模拟真实部署下的连接身份（非属主、无 BYPASSRLS）。
fn app_uri(uri: &str) -> String {
    let (scheme, rest) = uri
        .split_once("://")
        .expect("TEST_DATABASE_URL 需要带 scheme");
    let (_, host) = rest
        .rsplit_once('@')
        .expect("TEST_DATABASE_URL 需要带账号信息");

    format!("{scheme}://{APP_ROLE}:{APP_ROLE}@{host}")
}

async fn connect(uri: &str, max_connections: u32) -> DatabaseConnection {
    let mut options = ConnectOptions::new(uri.to_owned());
    options
        .max_connections(max_connections)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(10))
        .acquire_timeout(Duration::from_secs(30))
        .sqlx_logging(false);
    Database::connect(options).await.expect("连接测试库失败")
}

async fn exec<C: ConnectionTrait>(conn: &C, sql: &str) {
    if let Err(err) = conn.execute_unprepared(sql).await {
        panic!("SQL 执行失败：{sql}\n{err}");
    }
}

async fn count<C: ConnectionTrait>(conn: &C, sql: &str) -> i64 {
    conn.query_one_raw(sea_orm::Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
    .try_get_by_index::<i64>(0)
    .expect("结果不是 bigint")
}

/// 重建库、建角色、授权、种数据；锁未持有时不得调用。
async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let admin = connect(&uri, 2).await;

    migration::Migrator::fresh(&admin)
        .await
        .expect("重建测试库失败");

    let exists = count(
        &admin,
        &format!("SELECT count(*) FROM pg_roles WHERE rolname = '{APP_ROLE}'"),
    )
    .await;
    if exists == 0 {
        exec(
            &admin,
            &format!(
                "CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_ROLE}' \
                 NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
            ),
        )
        .await;
    }
    // 授权按对象生效，每次重建后都会丢，所以放在 fresh 之后
    for sql in [
        format!("GRANT USAGE ON SCHEMA public TO {APP_ROLE}"),
        format!(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}"
        ),
        format!("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}"),
    ] {
        exec(&admin, &sql).await;
    }

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(connect(&app_uri(&uri), 2).await, database_of(&uri)),
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
        platform_admin: UserId::generate(),
        member: UserId::generate(),
        disabled: UserId::generate(),
        legacy_role: UserId::generate(),
    };
    seed(&fixture).await;
    Some(fixture)
}

async fn seed(fixture: &Fixture) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    let admin = &fixture.admin;

    for (tag, user, role, status) in [
        ("admin", fixture.platform_admin, "ADMIN", "ACTIVE"),
        ("member", fixture.member, "USER", "ACTIVE"),
        ("disabled", fixture.disabled, "USER", "DISABLED"),
        ("legacy", fixture.legacy_role, "SUPERUSER", "ACTIVE"),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{user}', 'ctx-{suffix}-{tag}', '!', '{role}', '{status}', now(), now())"#
            ),
        )
        .await;
    }

    for (tag, tenant, name) in [
        ("a", fixture.tenant_a, "Ctx A"),
        ("b", fixture.tenant_b, "Ctx B"),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, "createdAt", "updatedAt")
                   VALUES ('{tenant}', '{name}', 'ctx-{suffix}-{tag}', now(), now())"#
            ),
        )
        .await;
    }

    // tenant_a：member 是有效 OWNER；legacy_role 是有效成员但角色字面量无法识别
    // tenant_b：member 的成员关系已停用
    for (tenant, user, role, status) in [
        (fixture.tenant_a, fixture.member, "OWNER", "ACTIVE"),
        (fixture.tenant_a, fixture.legacy_role, "SUPERUSER", "ACTIVE"),
        (fixture.tenant_b, fixture.member, "MEMBER", "DISABLED"),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
                   VALUES ('{}', '{tenant}', '{user}', '{role}', '{status}', now(), now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
    }
}

/// 一份「令牌只证明是谁」的声明：角色字段由调用方随意填写，用以证明它不决定授权。
fn claims(sub: &str, role: &str) -> Claims {
    Claims {
        sub: sub.to_owned(),
        username: "ctx".to_owned(),
        role: role.to_owned(),
        exp: FAR_FUTURE_EXP,
        iat: FAR_FUTURE_EXP - 3600,
    }
}

fn token_of(user: UserId, role: &str) -> (Claims, String) {
    let token = format!("ctx-token-{user}");

    (claims(&user.to_string(), role), token)
}

async fn resolve(
    fixture: &Fixture,
    user: UserId,
    claim_role: &str,
) -> Result<Session, SessionError> {
    let (claims, token) = token_of(user, claim_role);

    Session::resolve(&fixture.storage, &claims, &token).await
}

fn platform_manage() -> Permission {
    Permission::new(Resource::Account, Action::Manage)
}

#[tokio::test]
async fn db_role_is_authoritative_over_the_token_claim() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 令牌说自己是普通用户，库说他是管理员 → 以库为准
    let session = resolve(&fixture, fixture.platform_admin, "USER")
        .await
        .expect("库中为 ADMIN 的账号应当可以建立会话");
    assert_eq!(session.platform_role(), PlatformRole::Admin);
    assert!(session.is_platform_admin());
    assert_eq!(session.user_id(), fixture.platform_admin);
    assert_eq!(
        authz::require(&session.principal(), platform_manage()),
        Ok(())
    );

    // 令牌自称管理员，库说他是普通用户 → 不授权
    let session = resolve(&fixture, fixture.member, "ADMIN")
        .await
        .expect("库中为 USER 的账号也可以建立会话");
    assert_eq!(session.platform_role(), PlatformRole::User);
    assert!(!session.is_platform_admin());
    let denied = authz::require(&session.principal(), platform_manage())
        .expect_err("令牌里的 ADMIN 声明不得提权");
    assert_eq!(denied.reason(), DenyReason::PlatformRoleInsufficient);
    assert_eq!(
        authz::authorize(&session.principal(), platform_manage()),
        Decision::Deny(denied.reason())
    );
}

#[tokio::test]
async fn unusable_accounts_cannot_establish_a_session() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    assert!(matches!(
        resolve(&fixture, fixture.disabled, "ADMIN").await,
        Err(SessionError::AccountDisabled)
    ));

    assert!(matches!(
        resolve(&fixture, UserId::generate(), "ADMIN").await,
        Err(SessionError::UnknownAccount)
    ));

    let (claims, token) = token_of(fixture.member, "USER");
    let mut claims = claims;
    claims.sub = "not-a-uuid".to_owned();
    assert!(matches!(
        Session::resolve(&fixture.storage, &claims, &token).await,
        Err(SessionError::InvalidSubject)
    ));
}

#[tokio::test]
async fn unparseable_account_literal_fails_closed() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let err = resolve(&fixture, fixture.legacy_role, "ADMIN")
        .await
        .expect_err("库中角色字面量无法识别时必须拒绝，而不是降级");

    assert!(matches!(
        err,
        SessionError::Persist(PersistError::UnknownLiteral {
            column: "auth.role",
            ..
        })
    ));
}

#[tokio::test]
async fn membership_is_only_visible_inside_its_tenant_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tenant_a = TenantId::from_uuid(fixture.tenant_a);
    let tenant_b = TenantId::from_uuid(fixture.tenant_b);

    // 无租户作用域：应用连接看不到任何成员行（行级安全，而非行不存在）
    let hidden = persistence::membership(fixture.storage.raw(), tenant_a, fixture.member)
        .await
        .expect("无作用域的查询本身应当成功");
    assert!(hidden.is_none(), "未进入租户作用域时不得读到成员关系");
    let visible = persistence::membership(&fixture.admin, tenant_a, fixture.member)
        .await
        .expect("特权连接查询失败");
    assert_eq!(visible.and_then(|m| m.role()), Some(TenantRole::Owner));

    // 进入 tenant_a 作用域：读得到 OWNER
    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户事务失败");
    let membership = persistence::membership(&tx, tenant_a, fixture.member)
        .await
        .expect("作用域内查询失败")
        .expect("tenant_a 的成员关系应当可见");
    assert_eq!(membership.tenant_id(), tenant_a);
    assert_eq!(membership.role(), Some(TenantRole::Owner));

    // 作用域与目标租户不一致：跨租户读不到
    assert!(
        persistence::membership(&tx, tenant_b, fixture.member)
            .await
            .expect("跨租户查询本身应当成功")
            .is_none(),
        "作用域之外的租户成员关系必须不可见"
    );

    // 角色字面量无法识别：同一作用域内直接失败
    let err = persistence::membership(&tx, tenant_a, fixture.legacy_role)
        .await
        .expect_err("库中成员角色字面量无法识别时必须报错");
    assert!(matches!(
        err,
        PersistError::UnknownLiteral {
            column: "tenant_member.role",
            ..
        }
    ));
}

#[tokio::test]
async fn inactive_membership_is_not_a_membership() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_b))
        .await
        .expect("开启租户事务失败");
    assert!(
        persistence::membership(&tx, TenantId::from_uuid(fixture.tenant_b), fixture.member)
            .await
            .expect("查询本身应当成功")
            .is_none(),
        "停用的成员关系不构成成员身份"
    );
}

#[tokio::test]
async fn tenant_scope_guard_admits_members_and_platform_operators() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tenant_a = TenantId::from_uuid(fixture.tenant_a);
    let tenant_b = TenantId::from_uuid(fixture.tenant_b);
    let manage_tenant = Permission::new(Resource::Tenant, Action::Manage);

    // 成员：进入 tenant_a 作用域后身份为 OWNER，改租户放行
    let member_session = resolve(&fixture, fixture.member, "USER")
        .await
        .expect("库中为 USER 的账号也可以建立会话");
    {
        let ctx = TenantCtx::enter(&fixture.storage, &member_session, tenant_a)
            .await
            .expect("tenant_a 的 OWNER 应当可以进入作用域");
        assert_eq!(ctx.tenant_id(), tenant_a);
        assert_eq!(ctx.principal().tenant_role(), Some(TenantRole::Owner));
        assert!(ctx.require(manage_tenant).is_ok(), "OWNER 可以管理租户");
    }

    // 非成员（tenant_b 的成员关系已停用）：拒绝，且是权限类 403
    let err = TenantCtx::enter(&fixture.storage, &member_session, tenant_b)
        .await
        .err()
        .expect("停用的成员关系不得进入作用域");
    assert_eq!(err.code, auth::ACCESS_DENIED);
    assert_eq!(err.status(), StatusCode::FORBIDDEN);

    // 平台管理员：无成员身份也可进入（运维通道），此时上下文不带租户角色
    let admin_session = resolve(&fixture, fixture.platform_admin, "USER")
        .await
        .expect("库中为 ADMIN 的账号应当可以建立会话");
    {
        let ctx = TenantCtx::enter(&fixture.storage, &admin_session, tenant_b)
            .await
            .expect("平台管理员可以进入任意租户作用域");
        assert!(ctx.principal().tenant_role().is_none());
        assert!(
            ctx.require(manage_tenant).is_ok(),
            "运维通道由平台角色放行，不要求成员身份"
        );
    }

    // 建租户：作用域指向新标识，身份即为它的 OWNER
    let ctx = TenantCtx::open_new(&fixture.storage, &admin_session, TenantId::generate())
        .await
        .expect("建租户不应要求成员身份");
    assert_eq!(ctx.principal().tenant_role(), Some(TenantRole::Owner));
    assert!(ctx.require(manage_tenant).is_ok());
}
