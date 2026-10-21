//! 订阅服务的租户作用域端到端验证（P3b-3a）。
//!
//! 需要独立测试库与独立 Redis（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test \
//! TEST_REDIS_URL=redis://127.0.0.1:6379 \
//! cargo test --test subscription_scope
//! ```
//!
//! 两个变量缺任一即整体跳过。
//!
//! 断言的核心是「作用域即边界」：服务层不再自己拼 `tenantID = ?`，可见行完全由
//! `TenantScope`（`app.tenant_id` + 行级策略）决定。用例跑在非属主角色 `cogito_app_test` 上，
//! 与 `tenant_isolation.rs` 一样受行级安全约束——属主会绕过策略，那样测不出东西。

use std::sync::LazyLock;
use std::time::Duration;

use identity::{TenantId, UserId};
use migration::MigratorTrait;
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection};
use cogito::clients::redis::RedisPool;
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::guards::session::Session;
use cogito::guards::tenant::{TenantCtx, TenantScope};
use cogito::services::subscription::schema::SubscribeP;
use cogito::services::subscription::service::SubscriptionService;
use cogito::utils::code::{auth, resource};
use cogito::utils::jwt::Claims;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 隔离断言必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE，但角色侧也要对）。
const APP_ROLE: &str = "cogito_app_test";

/// 远超测试生命周期的过期时间（2100-01-01），避免用例受系统时钟影响。
const FAR_FUTURE_EXP: i64 = 4_102_444_800;

/// 配置里的档位配额：服务层只认 `gateway.plan_daily_token_quota`。
const PLAN_PRO_QUOTA: i64 = 5_000_000;
const PLAN_BASIC_QUOTA: i64 = 1_000_000;
const PLAN_SELF_SERVICE_QUOTA: i64 = 300_000;

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    /// 超级用户连接：种数据、按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用连接（非属主角色）：服务层唯一的数据入口。
    storage: Storage,
    redis: RedisPool,
    config: Configure,
    /// 个人租户：`owner_a` 是 OWNER，`member_a` 是 MEMBER。
    tenant_a: Uuid,
    /// 个人租户：只有 `owner_b`。
    tenant_b: Uuid,
    /// 团队租户：走全局配额，不参与个人订阅口径。
    tenant_team: Uuid,
    owner_a: UserId,
    member_a: UserId,
    owner_b: UserId,
    owner_team: UserId,
    /// 不属于任何租户。
    outsider: UserId,
    /// `tenant_a` 当前生效的订阅。
    subscription_a: Uuid,
    /// `tenant_b` 当前生效的订阅。
    subscription_b: Uuid,
    /// `tenant_team` 已过期的订阅（惰性清理用）。
    subscription_team: Uuid,
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

/// 读取测试 Redis 地址；未配置时返回 `None`（订阅热路径走缓存，没有它就测不了）。
fn test_redis_url() -> Option<String> {
    let url = std::env::var("TEST_REDIS_URL").ok()?;
    let url = url.trim().to_owned();

    if url.is_empty() { None } else { Some(url) }
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

async fn scalar_text<C: ConnectionTrait>(conn: &C, sql: &str) -> Option<String> {
    conn.query_one_raw(sea_orm::Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .map(|row| row.try_get_by_index::<String>(0).expect("结果不是 text"))
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

/// 重建库、建角色、授权、接 Redis、种数据；锁未持有时不得调用。
async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let redis_url = test_redis_url()?;
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

    let mut config = Configure::default();
    for (plan, quota) in [
        ("pro", PLAN_PRO_QUOTA),
        ("basic", PLAN_BASIC_QUOTA),
        ("selfserve", PLAN_SELF_SERVICE_QUOTA),
        ("legacy", 100),
    ] {
        config
            .gateway
            .plan_daily_token_quota
            .insert(plan.to_string(), quota);
    }

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(connect(&app_uri(&uri), 2).await, database_of(&uri)),
        redis: RedisPool::new(&redis_url, 2)
            .await
            .expect("连接测试 Redis 失败"),
        config,
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
        tenant_team: Uuid::new_v4(),
        owner_a: UserId::generate(),
        member_a: UserId::generate(),
        owner_b: UserId::generate(),
        owner_team: UserId::generate(),
        outsider: UserId::generate(),
        subscription_a: Uuid::new_v4(),
        subscription_b: Uuid::new_v4(),
        subscription_team: Uuid::new_v4(),
    };
    seed(&fixture).await;
    Some(fixture)
}

async fn seed(fixture: &Fixture) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    let admin = &fixture.admin;

    for (tag, user) in [
        ("owner-a", fixture.owner_a),
        ("member-a", fixture.member_a),
        ("owner-b", fixture.owner_b),
        ("owner-team", fixture.owner_team),
        ("outsider", fixture.outsider),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{user}', 'scope-{suffix}-{tag}', '!', 'USER', 'ACTIVE', now(), now())"#
            ),
        )
        .await;
    }

    for (tag, tenant, name, kind) in [
        ("a", fixture.tenant_a, "Scope A", "PERSONAL"),
        ("b", fixture.tenant_b, "Scope B", "PERSONAL"),
        ("team", fixture.tenant_team, "Scope Team", "TEAM"),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
                   VALUES ('{tenant}', '{name}', 'scope-{suffix}-{tag}', 'ACTIVE', '{kind}', now(), now())"#
            ),
        )
        .await;
    }

    for (tenant, user, role) in [
        (fixture.tenant_a, fixture.owner_a, "OWNER"),
        (fixture.tenant_a, fixture.member_a, "MEMBER"),
        (fixture.tenant_b, fixture.owner_b, "OWNER"),
        (fixture.tenant_team, fixture.owner_team, "OWNER"),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
                   VALUES ('{}', '{tenant}', '{user}', '{role}', 'ACTIVE', now(), now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
    }

    // A 与 B 各有一条永久生效的订阅；团队租户那条已过期，用于验证惰性清理
    for (id, tenant, plan, expires) in [
        (fixture.subscription_a, fixture.tenant_a, "pro", "NULL"),
        (fixture.subscription_b, fixture.tenant_b, "basic", "NULL"),
        (
            fixture.subscription_team,
            fixture.tenant_team,
            "legacy",
            "now() - interval '1 day'",
        ),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO subscription (id, "tenantID", plan, status, "expiresAt", "createdAt", "updatedAt")
                   VALUES ('{id}', '{tenant}', '{plan}', 'ACTIVE', {expires}, now(), now())"#
            ),
        )
        .await;
    }
}

async fn session_of(fixture: &Fixture, user: UserId) -> Session {
    let claims = Claims {
        sub: user.to_string(),
        username: "scope".to_owned(),
        role: "USER".to_owned(),
        exp: FAR_FUTURE_EXP,
        iat: FAR_FUTURE_EXP - 3600,
    };

    Session::resolve(&fixture.storage, &claims, &format!("scope-token-{user}"))
        .await
        .expect("建立会话失败")
}

async fn enter(fixture: &Fixture, user: UserId, tenant: Uuid) -> TenantCtx {
    let session = session_of(fixture, user).await;

    TenantCtx::enter(&fixture.storage, &session, TenantId::from_uuid(tenant))
        .await
        .expect("进入租户作用域失败")
}

/// 某个档位下的生效订阅数（超级用户口径，不受作用域影响）。
async fn active_subscriptions(fixture: &Fixture, tenant: Uuid) -> i64 {
    count(
        &fixture.admin,
        &format!(
            "SELECT count(*) FROM subscription \
             WHERE \"tenantID\" = '{tenant}' AND status = 'ACTIVE'"
        ),
    )
    .await
}

async fn subscription_status(fixture: &Fixture, id: Uuid) -> String {
    scalar_text(
        &fixture.admin,
        &format!("SELECT status FROM subscription WHERE id = '{id}'"),
    )
    .await
    .unwrap_or_else(|| panic!("订阅不存在：{id}"))
}

#[tokio::test]
async fn non_member_cannot_enter_a_tenant_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let session = session_of(&fixture, fixture.outsider).await;
    let err = match TenantCtx::enter(
        &fixture.storage,
        &session,
        TenantId::from_uuid(fixture.tenant_a),
    )
    .await
    {
        Ok(ctx) => {
            ctx.rollback().await.ok();
            panic!("非成员不得进入租户作用域");
        }
        Err(err) => err,
    };

    assert_eq!(err.code, auth::ACCESS_DENIED);
}

#[tokio::test]
async fn reads_stay_inside_the_entered_tenant() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 租户 A：只看得见自己的订阅
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let rows = SubscriptionService::list(&ctx).await.expect("列举订阅失败");
    assert_eq!(rows.len(), 1, "作用域外（租户 B 的）订阅不得可见");
    assert_eq!(rows[0].plan, "pro");
    assert_eq!(rows[0].tenant_id, fixture.tenant_a.to_string());

    let quota = SubscriptionService::quota(&ctx, &fixture.config, &fixture.redis)
        .await
        .expect("查询配额失败");
    assert_eq!(quota.tenant_type, "PERSONAL");
    assert_eq!(quota.source, "PLAN");
    assert_eq!(quota.plan.as_deref(), Some("pro"));
    assert_eq!(quota.daily_token_quota, PLAN_PRO_QUOTA);
    ctx.rollback().await.expect("只读作用域回滚失败");

    // 租户 B：看到的是自己那条
    let ctx = enter(&fixture, fixture.owner_b, fixture.tenant_b).await;
    let rows = SubscriptionService::list(&ctx).await.expect("列举订阅失败");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].plan, "basic");
    assert_eq!(rows[0].tenant_id, fixture.tenant_b.to_string());
    ctx.rollback().await.expect("只读作用域回滚失败");
}

#[tokio::test]
async fn hot_path_reads_open_their_own_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let plan_a =
        SubscriptionService::active_plan(&fixture.storage, &fixture.redis, fixture.tenant_a)
            .await
            .expect("读取生效档位失败");
    assert_eq!(plan_a.as_deref(), Some("pro"));

    let active = SubscriptionService::active_subscription(&fixture.storage, fixture.tenant_b)
        .await
        .expect("读取生效订阅失败")
        .expect("租户 B 应有一条生效订阅");
    assert_eq!(active.plan, "basic");
    assert!(active.expires_at.is_none());

    // 配额口径只对**持租户作用域**的调用方开放：团队租户在服务层回落到全局配额，
    // 「没有租户身份」的全局兜底（`global_quota`）只在网关热路径内部走到。
    for (user, tenant, source, plan, limit) in [
        (
            fixture.owner_a,
            fixture.tenant_a,
            "PLAN",
            Some("pro"),
            PLAN_PRO_QUOTA,
        ),
        (
            fixture.owner_b,
            fixture.tenant_b,
            "PLAN",
            Some("basic"),
            PLAN_BASIC_QUOTA,
        ),
        // 团队租户不参与个人订阅口径，回落全局配额
        (
            fixture.owner_team,
            fixture.tenant_team,
            "GLOBAL",
            None,
            1_000_000,
        ),
    ] {
        let ctx = enter(&fixture, user, tenant).await;
        let quota = SubscriptionService::quota(&ctx, &fixture.config, &fixture.redis)
            .await
            .expect("读取生效配额失败");
        assert_eq!(quota.source, source);
        assert_eq!(quota.plan.as_deref(), plan);
        assert_eq!(quota.daily_token_quota, limit);
        ctx.rollback().await.expect("只读作用域回滚失败");
    }
}

#[tokio::test]
async fn member_may_read_but_not_manage() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let ctx = enter(&fixture, fixture.member_a, fixture.tenant_a).await;
    assert_eq!(
        SubscriptionService::list(&ctx)
            .await
            .expect("MEMBER 应可读订阅")
            .len(),
        1
    );
    assert!(
        SubscriptionService::quota(&ctx, &fixture.config, &fixture.redis)
            .await
            .is_ok()
    );

    // 取消与开通都要 OWNER；MEMBER 在进入服务层前就被挡下
    let denied = SubscriptionService::cancel(&ctx, &fixture.redis, fixture.subscription_a)
        .await
        .expect_err("MEMBER 不得取消订阅");
    assert_eq!(denied.code, auth::INSUFFICIENT_PERMISSIONS);

    let denied = SubscriptionService::subscribe(
        &ctx,
        &fixture.config,
        &fixture.redis,
        SubscribeP {
            plan: "selfserve".to_owned(),
            expires_at: None,
        },
    )
    .await
    .expect_err("MEMBER 不得开通订阅");
    assert_eq!(denied.code, auth::INSUFFICIENT_PERMISSIONS);
    ctx.rollback().await.expect("只读作用域回滚失败");

    assert_eq!(
        subscription_status(&fixture, fixture.subscription_a).await,
        "ACTIVE"
    );
}

#[tokio::test]
async fn owner_subscribes_and_cancels_only_in_its_own_tenant() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 自助开通：写入必须落在自己的租户里，旧订阅被截断
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let created = SubscriptionService::subscribe(
        &ctx,
        &fixture.config,
        &fixture.redis,
        SubscribeP {
            plan: "selfserve".to_owned(),
            expires_at: None,
        },
    )
    .await
    .expect("OWNER 自助开通失败");
    assert_eq!(created.plan, "selfserve");
    assert_eq!(created.tenant_id, fixture.tenant_a.to_string());
    ctx.commit().await.expect("提交开通事务失败");

    let created_id = Uuid::parse_str(&created.id).expect("订阅 ID 不是 UUID");
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_a).await, 1);
    assert_eq!(
        subscription_status(&fixture, fixture.subscription_a).await,
        "CANCELED"
    );
    // 别的租户不受影响
    assert_eq!(
        subscription_status(&fixture, fixture.subscription_b).await,
        "ACTIVE"
    );
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_b).await, 1);

    // 跨租户取消：作用域内查不到那条订阅，只能 404
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let err = SubscriptionService::cancel(&ctx, &fixture.redis, fixture.subscription_b)
        .await
        .expect_err("不得取消别的租户的订阅");
    assert_eq!(err.code, resource::NOT_FOUND);
    ctx.rollback().await.expect("只读作用域回滚失败");
    assert_eq!(
        subscription_status(&fixture, fixture.subscription_b).await,
        "ACTIVE"
    );

    // 取消自己的订阅
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    SubscriptionService::cancel(&ctx, &fixture.redis, created_id)
        .await
        .expect("OWNER 取消订阅失败");
    ctx.commit().await.expect("提交取消事务失败");
    assert_eq!(subscription_status(&fixture, created_id).await, "CANCELED");
}

#[tokio::test]
async fn expired_subscriptions_are_lazily_swept_inside_the_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let ctx = enter(&fixture, fixture.owner_team, fixture.tenant_team).await;
    let rows = SubscriptionService::list(&ctx).await.expect("列举订阅失败");
    assert_eq!(rows.len(), 1);
    // 清理是写操作：调用方不提交，标记就不会落地
    ctx.commit().await.expect("提交惰性清理失败");

    assert_eq!(
        subscription_status(&fixture, fixture.subscription_team).await,
        "EXPIRED"
    );
}

#[tokio::test]
async fn machine_path_grant_writes_into_the_scope_tenant() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 可信通道只收作用域：租户取自作用域，`actor` 只是记账字段
    let scope = TenantScope::open(&fixture.storage, TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("打开租户作用域失败");
    let granted = SubscriptionService::grant(
        &scope,
        &fixture.config,
        &fixture.redis,
        fixture.owner_b,
        SubscribeP {
            plan: "pro".to_owned(),
            expires_at: None,
        },
    )
    .await
    .expect("可信通道开通失败");
    assert_eq!(granted.tenant_id, fixture.tenant_a.to_string());
    scope.commit().await.expect("提交可信通道事务失败");

    assert_eq!(active_subscriptions(&fixture, fixture.tenant_a).await, 1);
    assert_eq!(
        subscription_status(&fixture, fixture.subscription_a).await,
        "CANCELED"
    );
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_b).await, 1);

    // 团队租户不参与个人订阅口径
    let scope = TenantScope::open(&fixture.storage, TenantId::from_uuid(fixture.tenant_team))
        .await
        .expect("打开租户作用域失败");
    let err = SubscriptionService::grant(
        &scope,
        &fixture.config,
        &fixture.redis,
        fixture.owner_team,
        SubscribeP {
            plan: "pro".to_owned(),
            expires_at: None,
        },
    )
    .await
    .expect_err("团队租户不得开通个人订阅");
    assert!(matches!(
        err,
        cogito::services::subscription::service::SubscriptionError::NotPersonal
    ));
    scope.rollback().await.expect("回滚失败");
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_team).await, 1);
}
