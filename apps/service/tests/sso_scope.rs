//! SSO 连接的作用域端到端验证（P3e-2）。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test cargo test --test sso_scope
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! `sso_connection` 是唯一一张**同时**靠租户和靠能力键访问的表：
//!
//! 1. 能力键分支 —— 只凭连接 id 读回那一行**未归档**连接（匿名 OIDC 流程唯一的凭证）；
//! 2. 租户分支 —— 该租户的连接（含已归档，管理面要用）；
//! 3. 账号分支 —— 没有，账号作用域一行都读不到；
//! 4. 平台特权 —— 运维面跨租户，写入由平台管理员指定租户；
//! 5. `WITH CHECK` 仍是租户限定：拿到连接 id 也只能读，写要另开租户作用域。
//!
//! 用例跑在非属主角色 `cogito_app_test` 上：属主会绕过策略，那样测不出东西。

use std::sync::LazyLock;
use std::time::Duration;

use entity::sso_connection;
use identity::{TenantId, UserId};
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection,
    DatabaseTransaction, EntityTrait,
};
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::guards::account::AccountScope;
use cogito::guards::platform::PlatformScope;
use cogito::guards::sso::{SsoConnectionScope, SsoLoginScope};
use cogito::guards::tenant::TenantScope;
use cogito::services::sso::service::SsoService;
use cogito::utils::db::is_row_security_violation;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 隔离断言必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE）。
const APP_ROLE: &str = "cogito_app_test";

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    /// 超级用户连接：种数据，并按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用连接（非属主角色，靠成员关系借用平台角色）。
    storage: Storage,
    config: Configure,
    tenant_a: Uuid,
    tenant_b: Uuid,
    /// `tenant_a` 的成员，登录流程要落成成员关系的那位。
    user: UserId,
    /// `tenant_a` 的启用中连接。
    conn_a: Uuid,
    /// `tenant_b` 的启用中连接。
    conn_b: Uuid,
    /// `tenant_a` 的已归档连接：管理面看得到，能力键看不到。
    conn_archived: Uuid,
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

/// 重建库、建应用角色、授权、种两个租户与三条连接；锁未持有时不得调用。
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
    // 迁移里由超级用户建好 `cogito_platform`；这里把成员关系拨到测试角色上（平台面用例需要）
    exec(&admin, &format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}")).await;

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(connect(&app_uri(&uri), 2).await, database_of(&uri)),
        config: Configure::default(),
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
        user: UserId::generate(),
        conn_a: Uuid::new_v4(),
        conn_b: Uuid::new_v4(),
        conn_archived: Uuid::new_v4(),
    };
    seed(&fixture).await;
    Some(fixture)
}

/// 两个租户、一位账号、三条连接（租户 A 的启用中 / 已归档，租户 B 的启用中）。
async fn seed(fixture: &Fixture) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    let admin = &fixture.admin;

    for (tag, tenant) in [("a", fixture.tenant_a), ("b", fixture.tenant_b)] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
                   VALUES ('{tenant}', 'Sso {tag}', 'sso-{suffix}-{tag}', 'ACTIVE', 'PERSONAL', now(), now())"#
            ),
        )
        .await;
    }

    exec(
        admin,
        &format!(
            r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
               VALUES ('{}', 'sso-{suffix}', '!', 'USER', 'ACTIVE', now(), now())"#,
            fixture.user
        ),
    )
    .await;

    for (id, tenant, archived) in [
        (fixture.conn_a, fixture.tenant_a, false),
        (fixture.conn_b, fixture.tenant_b, false),
        (fixture.conn_archived, fixture.tenant_a, true),
    ] {
        let archived = if archived { "now()" } else { "NULL" };
        exec(
            admin,
            &format!(
                r#"INSERT INTO sso_connection
                       (id, "tenantID", provider, issuer, "clientID", "clientSecretEnc",
                        "redirectUri", status, "archivedAt", "createdAt", "updatedAt")
                   VALUES ('{id}', '{tenant}', 'mock', 'https://idp.example.com', 'client-{suffix}',
                           '', 'https://app.example.com/callback', 'ACTIVE', {archived}, now(), now())"#
            ),
        )
        .await;
    }
}

/// 当前事务里看得见的连接 id（行级策略是唯一的过滤器），排序后便于整体比较。
async fn visible_ids(tx: &DatabaseTransaction) -> Vec<String> {
    let mut ids: Vec<String> = sso_connection::Entity::find()
        .all(tx)
        .await
        .expect("列举可见连接失败")
        .iter()
        .map(|row| row.id.to_string())
        .collect();

    ids.sort();
    ids
}

/// 期望值：把若干连接 id 变成与 `visible_ids` 同口径的有序列表。
fn expected(connections: &[Uuid]) -> Vec<String> {
    let mut ids: Vec<String> = connections.iter().map(Uuid::to_string).collect();

    ids.sort();
    ids
}

/// 能力键只借出它点名的那一行**未归档**连接：别的连接、归档行都读不到。
#[tokio::test]
async fn capability_key_reads_only_the_connection_it_names() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = SsoConnectionScope::open(&fixture.storage, fixture.conn_a)
        .await
        .expect("进入连接能力键作用域失败");
    assert_eq!(
        visible_ids(scope.tx()).await,
        expected(&[fixture.conn_a]),
        "能力键只该命中自己那一行：另一个租户的连接与归档行都不能漏"
    );
    scope.close().await.expect("释放能力键事务失败");

    // 归档行不给借：连接被归档后，旧回调地址不该还能把流程接回去
    let archived = SsoConnectionScope::open(&fixture.storage, fixture.conn_archived)
        .await
        .expect("进入连接能力键作用域失败");
    assert!(
        visible_ids(archived.tx()).await.is_empty(),
        "已归档连接不该被能力键读出来"
    );
    archived.close().await.expect("释放能力键事务失败");

    // 不存在的连接 id 同样是「读不到」，而不是别的错误
    let missing = SsoConnectionScope::open(&fixture.storage, Uuid::new_v4())
        .await
        .expect("进入连接能力键作用域失败");
    assert!(
        visible_ids(missing.tx()).await.is_empty(),
        "未知连接 id 不该看到任何行"
    );
    missing.close().await.expect("释放能力键事务失败");
}

/// 能力键只放宽读：换到写方向仍要租户作用域，改/增都撞行级安全。
#[tokio::test]
async fn capability_key_never_writes() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 改：命中能力键借出的那一行，`USING` 放行、`WITH CHECK` 拒绝
    let scope = SsoConnectionScope::open(&fixture.storage, fixture.conn_a)
        .await
        .expect("进入连接能力键作用域失败");
    let update = scope
        .tx()
        .execute_unprepared(&format!(
            r#"UPDATE sso_connection SET provider = 'forged' WHERE id = '{}'"#,
            fixture.conn_a
        ))
        .await
        .expect_err("能力键事务里的更新必须被拒绝");
    assert!(
        is_row_security_violation(&update),
        "应当撞上行级安全检查，实际 {update:?}"
    );
    scope.close().await.expect("释放能力键事务失败");

    // 增：写进另一个租户（能力键事务没有租户，写哪一行都是越权）
    // 行级安全检查会让整个事务作废，所以每个断言各用一段事务
    let scope = SsoConnectionScope::open(&fixture.storage, fixture.conn_a)
        .await
        .expect("进入连接能力键作用域失败");
    let insert = scope
        .tx()
        .execute_unprepared(&format!(
            r#"INSERT INTO sso_connection
                   (id, "tenantID", provider, issuer, "clientID", "clientSecretEnc",
                    "redirectUri", status, "createdAt", "updatedAt")
               VALUES ('{}', '{}', 'mock', 'https://idp.example.com', 'forged', '',
                       'https://app.example.com/callback', 'ACTIVE', now(), now())"#,
            Uuid::new_v4(),
            fixture.tenant_b
        ))
        .await
        .expect_err("能力键事务里的写入必须被拒绝");
    assert!(
        is_row_security_violation(&insert),
        "应当撞上行级安全检查，实际 {insert:?}"
    );
    scope.close().await.expect("释放能力键事务失败");

    // 对账：能力键事务没有把任何一行改坏
    let provider: String = fixture
        .admin
        .query_one_raw(sea_orm::Statement::from_string(
            DatabaseBackend::Postgres,
            format!(
                r#"SELECT provider FROM sso_connection WHERE id = '{}'"#,
                fixture.conn_a
            ),
        ))
        .await
        .expect("查询失败")
        .expect("连接行应当存在")
        .try_get_by_index::<String>(0)
        .expect("provider 不是文本");
    assert_eq!(provider, "mock", "能力键事务不该改到任何一行");
}

/// 租户作用域看到本租户的连接（含已归档），看不到别的租户。
#[tokio::test]
async fn tenant_scope_sees_own_connections_only() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let a = TenantScope::open(&fixture.storage, TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("进入租户 A 作用域失败");
    assert_eq!(
        visible_ids(a.tx()).await,
        expected(&[fixture.conn_a, fixture.conn_archived]),
        "租户 A 应看到自己的两条连接（含已归档），看不到租户 B 的"
    );
    a.rollback().await.expect("回滚租户事务失败");

    let b = TenantScope::open(&fixture.storage, TenantId::from_uuid(fixture.tenant_b))
        .await
        .expect("进入租户 B 作用域失败");
    assert_eq!(
        visible_ids(b.tx()).await,
        expected(&[fixture.conn_b]),
        "租户 B 只该看到自己那一条"
    );
    b.rollback().await.expect("回滚租户事务失败");
}

/// 账号作用域没有连接分支：连接属于租户，不属于某一个账号。
#[tokio::test]
async fn account_scope_cannot_read_connections() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let account = AccountScope::open(&fixture.storage, fixture.user)
        .await
        .expect("进入账号作用域失败");
    assert!(
        visible_ids(account.tx()).await.is_empty(),
        "账号作用域不该看到任何 SSO 连接"
    );
    account.rollback().await.expect("回滚账号事务失败");
}

/// 平台特权面：跨租户列连接，并能为指定租户建连接。
#[tokio::test]
async fn platform_scope_spans_tenants_for_connection_admin() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("进入平台特权作用域失败");

    let listed = SsoService::list_connections(&scope)
        .await
        .expect("平台面列连接失败");
    let mut ids: Vec<String> = listed.iter().map(|row| row.id.to_string()).collect();
    ids.sort();
    assert_eq!(
        ids,
        expected(&[fixture.conn_a, fixture.conn_b, fixture.conn_archived]),
        "运维面应当看到所有租户的连接"
    );

    let created = SsoService::create_connection(
        &scope,
        &fixture.config,
        fixture.user.as_uuid(),
        cogito::services::sso::schema::SsoConnectionWriteP {
            tenant_id: fixture.tenant_b.to_string(),
            provider: "mock".to_owned(),
            issuer: "https://idp.example.com/".to_owned(),
            client_id: "ops-client".to_owned(),
            client_secret: None,
            redirect_uri: "https://app.example.com/callback".to_owned(),
            status: None,
        },
    )
    .await
    .expect("平台面建连接失败");
    assert_eq!(created.tenant_id, fixture.tenant_b.to_string());
    scope.commit().await.expect("提交平台事务失败");

    let total = count(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM sso_connection WHERE "tenantID" = '{}'"#,
            fixture.tenant_b
        ),
    )
    .await;
    assert_eq!(total, 2, "租户 B 名下应当多出一条连接");
}

/// 两段式登录：能力键读出连接所属租户，再在该租户作用域里落成员关系。
#[tokio::test]
async fn login_scope_writes_membership_inside_connection_tenant() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 阶段一：只凭连接 id 找到租户（这正是 authorize / callback 第一步在做的事）
    let connection = SsoConnectionScope::open(&fixture.storage, fixture.conn_a)
        .await
        .expect("进入连接能力键作用域失败");
    let tenant = sso_connection::Entity::find_by_id(fixture.conn_a)
        .one(connection.tx())
        .await
        .expect("读连接失败")
        .expect("能力键应当读得到这一行")
        .tenant_id;
    connection.close().await.expect("释放能力键事务失败");

    // 阶段二：按该租户开短事务落库（这正对应 callback 尾部：账号 + 成员关系一起提交）
    let scope = SsoLoginScope::open(&fixture.storage, TenantId::from_uuid(tenant))
        .await
        .expect("进入登录落库作用域失败");
    insert_member(scope.tx(), fixture.tenant_a, fixture.user)
        .await
        .expect("往连接所属租户写成员关系应当成功");
    scope.commit().await.expect("提交登录事务失败");

    // 同一段作用域里换成别的租户：`WITH CHECK` 拦下（越权时整个事务作废，故单独一段）
    let scope = SsoLoginScope::open(&fixture.storage, TenantId::from_uuid(tenant))
        .await
        .expect("进入登录落库作用域失败");
    let forged = insert_member(scope.tx(), fixture.tenant_b, fixture.user)
        .await
        .expect_err("往别的租户写成员关系必须被拒绝");
    assert!(
        is_row_security_violation(&forged),
        "应当撞上行级安全检查，实际 {forged:?}"
    );
    scope.rollback().await.expect("回滚登录事务失败");

    let only_a = count(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM tenant_member WHERE "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(only_a, 1, "成员关系应当落在连接所属租户");
    let only_b = count(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM tenant_member WHERE "tenantID" = '{}'"#,
            fixture.tenant_b
        ),
    )
    .await;
    assert_eq!(only_b, 0, "越租户的成员关系不该落库");
}

async fn insert_member(
    tx: &DatabaseTransaction,
    tenant_id: Uuid,
    user_id: UserId,
) -> Result<sea_orm::ExecResult, sea_orm::DbErr> {
    tx.execute_unprepared(&format!(
        r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
           VALUES ('{}', '{tenant_id}', '{user_id}', 'MEMBER', 'ACTIVE', now(), now())"#,
        Uuid::new_v4()
    ))
    .await
}
