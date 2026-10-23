//! 支付订单的租户作用域端到端验证（P3b-3c）。
//!
//! 需要独立测试库与独立 Redis（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test \
//! TEST_REDIS_URL=redis://127.0.0.1:6379 \
//! cargo test --test payment_scope
//! ```
//!
//! 两个变量缺任一即整体跳过。
//!
//! 断言三条边界：
//! 1. 租户边界 —— 订单读写完全由 `TenantScope` 决定，服务层不再自己拼 `tenantID = ?`
//!    （改造前订单走的是无作用域的池，行级策略把这些语句挡成「0 行」，是真实故障）；
//! 2. 权限边界 —— 目录对 MEMBER 开放，账单只给 ADMIN / OWNER 看，花钱只给 OWNER；
//! 3. 能力键边界 —— 匿名回调只有订单号，它借来的**只有那一行未归档订单**，且是只读的。
//!
//! 用例跑在非属主角色 `cogito_app_test` 上：属主会绕过行级策略，那样测不出东西。

use std::sync::LazyLock;
use std::time::Duration;

use identity::{TenantId, UserId};
use migration::MigratorTrait;
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection};
use cogito::clients::redis::RedisPool;
use cogito::configures::configure::{Configure, PayPlanConfig};
use cogito::databases::database::Storage;
use cogito::guards::payment::PaymentNotifyScope;
use cogito::guards::session::Session;
use cogito::guards::tenant::TenantCtx;
use cogito::services::payment::schema::OrderP;
use cogito::services::payment::service::{PaymentError, PaymentService};
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

/// 售价（分）。订单金额必须与配置一致，否则 `unsellable_reason` / `sync` 的口径会打架。
const PLAN_PRO_AMOUNT: i64 = 1_990;
const PLAN_BASIC_AMOUNT: i64 = 990;

/// 默认订单有效期（秒），见 `PayConfig::default`。
const ORDER_TTL_SECS: u64 = 1_800;

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// 种子订单的订单号（`tag` 固定，随机段每次运行都不同）。
struct Orders {
    /// A 租户：待支付且未过期。
    a_pending: String,
    /// A 租户：已收款但没开通订阅（查单自愈用）。
    a_paid: String,
    /// A 租户：待支付且已过期（惰性关单用）。
    a_expired: String,
    /// A 租户：已归档（任何入口都不该看见）。
    a_archived: String,
    /// B 租户：待支付且未过期。
    b_pending: String,
    /// B 租户：待支付且已过期（用于证明关单不会被别的租户触发）。
    b_expired: String,
}

struct Fixture {
    /// 超级用户连接：种数据、按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用连接（非属主角色）：服务层唯一的数据入口。
    storage: Storage,
    redis: RedisPool,
    config: Configure,
    /// 个人租户：`owner_a` 是 OWNER，`admin_a` 是 ADMIN，`member_a` 是 MEMBER。
    tenant_a: Uuid,
    /// 个人租户：只有 `owner_b`。
    tenant_b: Uuid,
    /// 团队租户：不开放购买。
    tenant_team: Uuid,
    owner_a: UserId,
    admin_a: UserId,
    member_a: UserId,
    owner_b: UserId,
    owner_team: UserId,
    orders: Orders,
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

/// 执行一条**应当被拒**的语句，返回错误文案；成功则 `None`。
async fn exec_err<C: ConnectionTrait>(conn: &C, sql: &str) -> Option<String> {
    conn.execute_unprepared(sql)
        .await
        .err()
        .map(|err| err.to_string())
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
    for (plan, quota) in [("pro", PLAN_PRO_QUOTA), ("basic", PLAN_BASIC_QUOTA)] {
        config
            .gateway
            .plan_daily_token_quota
            .insert(plan.to_string(), quota);
    }
    // 定价：`pro` / `basic` 可售；`bare` 有价但没有日配额（开通后无法计费，必须显示为不可购买）
    config.pay.plans.insert(
        "pro".to_string(),
        PayPlanConfig {
            amount: PLAN_PRO_AMOUNT,
            duration_days: Some(30),
            label: Some("Pro".to_string()),
        },
    );
    config.pay.plans.insert(
        "basic".to_string(),
        PayPlanConfig {
            amount: PLAN_BASIC_AMOUNT,
            duration_days: Some(30),
            label: Some("Basic".to_string()),
        },
    );
    config.pay.plans.insert(
        "bare".to_string(),
        PayPlanConfig {
            amount: PLAN_BASIC_AMOUNT,
            duration_days: None,
            label: None,
        },
    );

    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
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
        admin_a: UserId::generate(),
        member_a: UserId::generate(),
        owner_b: UserId::generate(),
        owner_team: UserId::generate(),
        orders: Orders {
            a_pending: format!("PA{suffix}"),
            a_paid: format!("PAAP{suffix}"),
            a_expired: format!("PAEX{suffix}"),
            a_archived: format!("PAAR{suffix}"),
            b_pending: format!("PBBP{suffix}"),
            b_expired: format!("PBEX{suffix}"),
        },
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
        ("admin-a", fixture.admin_a),
        ("member-a", fixture.member_a),
        ("owner-b", fixture.owner_b),
        ("owner-team", fixture.owner_team),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{user}', 'pay-{suffix}-{tag}', '!', 'USER', 'ACTIVE', now(), now())"#
            ),
        )
        .await;
    }

    for (tag, tenant, name, kind) in [
        ("a", fixture.tenant_a, "Pay A", "PERSONAL"),
        ("b", fixture.tenant_b, "Pay B", "PERSONAL"),
        ("team", fixture.tenant_team, "Pay Team", "TEAM"),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
                   VALUES ('{tenant}', '{name}', 'pay-{suffix}-{tag}', 'ACTIVE', '{kind}', now(), now())"#
            ),
        )
        .await;
    }

    for (tenant, user, role) in [
        (fixture.tenant_a, fixture.owner_a, "OWNER"),
        (fixture.tenant_a, fixture.admin_a, "ADMIN"),
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

    let in_a_day = "now() + interval '1 day'";
    let an_hour_ago = "now() - interval '1 hour'";
    let orders: [(&str, Uuid, UserId, &str, i64, &str, &str, &str); 6] = [
        (
            &fixture.orders.a_pending,
            fixture.tenant_a,
            fixture.owner_a,
            "pro",
            PLAN_PRO_AMOUNT,
            "PENDING",
            in_a_day,
            "NULL",
        ),
        (
            &fixture.orders.a_paid,
            fixture.tenant_a,
            fixture.owner_a,
            "pro",
            PLAN_PRO_AMOUNT,
            "PAID",
            in_a_day,
            "now()",
        ),
        (
            &fixture.orders.a_expired,
            fixture.tenant_a,
            fixture.owner_a,
            "pro",
            PLAN_PRO_AMOUNT,
            "PENDING",
            an_hour_ago,
            "NULL",
        ),
        (
            &fixture.orders.a_archived,
            fixture.tenant_a,
            fixture.owner_a,
            "pro",
            PLAN_PRO_AMOUNT,
            "PENDING",
            in_a_day,
            "NULL",
        ),
        (
            &fixture.orders.b_pending,
            fixture.tenant_b,
            fixture.owner_b,
            "basic",
            PLAN_BASIC_AMOUNT,
            "PENDING",
            in_a_day,
            "NULL",
        ),
        (
            &fixture.orders.b_expired,
            fixture.tenant_b,
            fixture.owner_b,
            "basic",
            PLAN_BASIC_AMOUNT,
            "PENDING",
            an_hour_ago,
            "NULL",
        ),
    ];

    for (order_no, tenant, user, plan, amount, status, expires, paid_at) in orders {
        let archived_at = if order_no == &fixture.orders.a_archived {
            "now()"
        } else {
            "NULL"
        };
        exec(
            admin,
            &format!(
                r#"INSERT INTO payment_order
                     (id, "orderNo", "tenantID", "userID", plan, channel, amount, currency, status,
                      "durationDays", "expiresAt", "paidAt", "archivedAt", "createdAt", creator, "updatedAt", updater)
                   VALUES ('{}', '{order_no}', '{tenant}', '{user}', '{plan}', 'WECHAT', {amount}, 'CNY',
                           '{status}', 30, {expires}, {paid_at}, {archived_at}, now(), '{user}', now(), '{user}')"#,
                Uuid::new_v4()
            ),
        )
        .await;
    }
}

async fn session_of(fixture: &Fixture, user: UserId) -> Session {
    let claims = Claims {
        sub: user.to_string(),
        username: "pay-scope".to_owned(),
        role: "USER".to_owned(),
        exp: FAR_FUTURE_EXP,
        iat: FAR_FUTURE_EXP - 3600,
    };

    Session::resolve(
        &fixture.storage,
        &claims,
        &format!("pay-scope-token-{user}"),
    )
    .await
    .expect("建立会话失败")
}

async fn enter(fixture: &Fixture, user: UserId, tenant: Uuid) -> TenantCtx {
    let session = session_of(fixture, user).await;

    TenantCtx::enter(&fixture.storage, &session, TenantId::from_uuid(tenant))
        .await
        .expect("进入租户作用域失败")
}

/// 超级用户口径读订单状态（不受作用域影响）。
async fn order_status(fixture: &Fixture, order_no: &str) -> String {
    scalar_text(
        &fixture.admin,
        &format!("SELECT status FROM payment_order WHERE \"orderNo\" = '{order_no}'"),
    )
    .await
    .unwrap_or_else(|| panic!("订单不存在：{order_no}"))
}

/// 超级用户口径读订单备注。
async fn order_remark(fixture: &Fixture, order_no: &str) -> Option<String> {
    scalar_text(
        &fixture.admin,
        &format!("SELECT coalesce(remark, '') FROM payment_order WHERE \"orderNo\" = '{order_no}'"),
    )
    .await
    .filter(|remark| !remark.is_empty())
}

/// 某个租户的生效订阅数（超级用户口径）。
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

#[tokio::test]
async fn cross_tenant_orders_are_invisible() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 租户 A：只看得见自己未归档的三张单，归档单从不出现
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let a_orders = PaymentService::list(&ctx, &fixture.config, 50)
        .await
        .expect("列举订单失败");
    let mut a_nos = a_orders
        .iter()
        .map(|order| order.order_no.clone())
        .collect::<Vec<_>>();
    a_nos.sort();
    let mut expected = vec![
        fixture.orders.a_pending.clone(),
        fixture.orders.a_paid.clone(),
        fixture.orders.a_expired.clone(),
    ];
    expected.sort();
    assert_eq!(a_nos, expected, "订单列表越过了租户或归档边界");
    assert!(
        a_orders
            .iter()
            .all(|order| order.tenant_id == fixture.tenant_a.to_string()),
        "列表里混进了别的租户"
    );
    ctx.commit().await.expect("提交失败");

    // 跨租户按订单号取单：看不到就是「不存在」，不是 500
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let err = PaymentService::get(&ctx, &fixture.config, &fixture.orders.b_pending)
        .await
        .expect_err("A 不该看见 B 的订单");
    assert!(matches!(err, PaymentError::OrderNotFound));

    let err = PaymentService::get(&ctx, &fixture.config, &fixture.orders.a_archived)
        .await
        .expect_err("归档订单不该被取到");
    assert!(matches!(err, PaymentError::OrderNotFound));
    ctx.rollback().await.expect("回滚失败");

    // 租户 B 只能看见自己的两张单
    let ctx = enter(&fixture, fixture.owner_b, fixture.tenant_b).await;
    let b_orders = PaymentService::list(&ctx, &fixture.config, 50)
        .await
        .expect("列举订单失败");
    let mut b_nos = b_orders
        .iter()
        .map(|order| order.order_no.clone())
        .collect::<Vec<_>>();
    b_nos.sort();
    let mut expected = vec![
        fixture.orders.b_pending.clone(),
        fixture.orders.b_expired.clone(),
    ];
    expected.sort();
    assert_eq!(b_nos, expected, "B 的列表里混进了 A 的订单");
    ctx.rollback().await.expect("回滚失败");

    // 跨租户关单：写路径同样被作用域挡住
    let ctx = enter(&fixture, fixture.owner_b, fixture.tenant_b).await;
    let err = PaymentService::close(&ctx, &fixture.config, &fixture.orders.a_pending)
        .await
        .expect_err("B 不该关掉 A 的订单");
    assert!(matches!(err, PaymentError::OrderNotFound));
    ctx.rollback().await.expect("回滚失败");

    // 反向确认：A 的单还在待支付
    assert_eq!(
        order_status(&fixture, &fixture.orders.a_pending).await,
        "PENDING"
    );
}

#[tokio::test]
async fn only_its_own_expired_orders_are_closed_lazily() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // A 的列表顺带关掉自己的过期单
    let ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    PaymentService::list(&ctx, &fixture.config, 50)
        .await
        .expect("列举订单失败");
    ctx.commit().await.expect("提交失败");

    assert_eq!(
        order_status(&fixture, &fixture.orders.a_expired).await,
        "CLOSED"
    );
    assert_eq!(
        order_remark(&fixture, &fixture.orders.a_expired).await,
        Some("超时未支付".to_string())
    );
    // 关单是**本租户**的动作：B 的过期单必须原封不动
    assert_eq!(
        order_status(&fixture, &fixture.orders.b_expired).await,
        "PENDING",
        "关单越过了租户边界"
    );
}

#[tokio::test]
async fn member_reads_the_catalog_but_not_the_bills() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let ctx = enter(&fixture, fixture.member_a, fixture.tenant_a).await;

    // 目录与订阅同权：MEMBER 能看到自己的配额，就该能看到价格
    let catalog = PaymentService::catalog(&ctx, &fixture.config, &fixture.redis)
        .await
        .expect("MEMBER 应当能看到支付目录");
    assert_eq!(catalog.currency, "CNY");
    assert_eq!(catalog.order_ttl_secs, ORDER_TTL_SECS);
    assert_eq!(catalog.channels.len(), 2);
    assert!(
        catalog.channels.iter().all(|channel| !channel.enabled),
        "测试配置没有渠道凭据，渠道应当全部不可用"
    );
    assert_eq!(catalog.current_plan, None);
    let pro = catalog
        .plans
        .iter()
        .find(|plan| plan.plan == "pro")
        .expect("目录缺少 pro 档位");
    assert!(pro.purchasable, "pro 已定价且有配额，应当可购买");
    assert_eq!(pro.amount, PLAN_PRO_AMOUNT);
    assert_eq!(pro.daily_token_quota, PLAN_PRO_QUOTA);
    let unsellable = catalog
        .plans
        .iter()
        .find(|plan| plan.plan == "bare")
        .expect("目录缺少 bare 档位");
    assert!(!unsellable.purchasable);
    assert!(unsellable.reason.is_some(), "不可购买的档位必须说明原因");

    // 账单属于租户经营数据：MEMBER 不读、不关、不下单
    let err = PaymentService::list(&ctx, &fixture.config, 50)
        .await
        .expect_err("MEMBER 不该看到订单列表");
    assert!(matches!(err, PaymentError::Forbidden));

    let err = PaymentService::get(&ctx, &fixture.config, &fixture.orders.a_pending)
        .await
        .expect_err("MEMBER 不该看到订单详情");
    assert!(matches!(err, PaymentError::Forbidden));

    let err = PaymentService::close(&ctx, &fixture.config, &fixture.orders.a_pending)
        .await
        .expect_err("MEMBER 不该关单");
    assert!(matches!(err, PaymentError::Forbidden));

    let mut ctx = enter(&fixture, fixture.member_a, fixture.tenant_a).await;
    let err = PaymentService::create(
        &mut ctx,
        &fixture.storage,
        &fixture.config,
        OrderP {
            plan: "pro".to_string(),
            channel: "WECHAT".to_string(),
        },
    )
    .await
    .expect_err("MEMBER 不该下单");
    assert!(matches!(err, PaymentError::Forbidden));
    ctx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn admin_reads_the_bills_but_cannot_spend() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let mut ctx = enter(&fixture, fixture.admin_a, fixture.tenant_a).await;
    let orders = PaymentService::list(&ctx, &fixture.config, 50)
        .await
        .expect("ADMIN 应当能看到订单列表");
    assert_eq!(orders.len(), 3);

    // 下单（花钱）是 OWNER 的决定：ADMIN 过不了权限门，卡在渠道之前
    let err = PaymentService::create(
        &mut ctx,
        &fixture.storage,
        &fixture.config,
        OrderP {
            plan: "pro".to_string(),
            channel: "WECHAT".to_string(),
        },
    )
    .await
    .expect_err("ADMIN 不该下单");
    assert!(matches!(err, PaymentError::Forbidden));

    let err = PaymentService::close(&ctx, &fixture.config, &fixture.orders.a_pending)
        .await
        .expect_err("ADMIN 不该关单");
    assert!(matches!(err, PaymentError::Forbidden));
    ctx.rollback().await.expect("回滚失败");

    // 团队租户不开放购买：OWNER 也过不了「仅个人租户」这一关
    let mut ctx = enter(&fixture, fixture.owner_team, fixture.tenant_team).await;
    let err = PaymentService::create(
        &mut ctx,
        &fixture.storage,
        &fixture.config,
        OrderP {
            plan: "pro".to_string(),
            channel: "WECHAT".to_string(),
        },
    )
    .await
    .expect_err("团队租户不该能下单");
    assert!(matches!(err, PaymentError::NotPersonal));
    ctx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn a_notify_callback_resolves_the_tenant_from_the_order_number() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 订单号 → 租户：A 的单反解出 A，B 的单反解出 B
    for (order_no, tenant) in [
        (&fixture.orders.a_pending, fixture.tenant_a),
        (&fixture.orders.b_pending, fixture.tenant_b),
    ] {
        let scope = PaymentNotifyScope::open(&fixture.storage, order_no)
            .await
            .expect("开启回调作用域失败")
            .unwrap_or_else(|| panic!("订单 {order_no} 应当能反解出租户"));
        assert_eq!(scope.tenant_id().as_uuid(), tenant);
        scope.rollback().await.expect("回滚失败");
    }

    // 未知订单号与已归档订单：业务上是「订单不存在」，不是 500
    for order_no in [
        "PNOTEXISTS0000".to_string(),
        fixture.orders.a_archived.clone(),
    ] {
        let scope = PaymentNotifyScope::open(&fixture.storage, &order_no)
            .await
            .unwrap_or_else(|err| panic!("反解失败不该是数据库错误：{err}"));
        assert!(scope.is_none(), "{order_no} 不该被反解出租户");
    }
}

#[tokio::test]
async fn the_order_capability_reads_exactly_one_unarchived_order() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 只带能力键：看到且只看到那一行未归档订单（同租户的另外三张都看不见，归档的那张也不例外）
    let tx = fixture
        .storage
        .order_tx(&fixture.orders.a_pending)
        .await
        .expect("开启能力键事务失败");
    assert_eq!(count(&tx, "SELECT count(*) FROM payment_order").await, 1);
    assert_eq!(
        scalar_text(
            &tx,
            &format!(
                "SELECT \"orderNo\" FROM payment_order WHERE \"orderNo\" = '{}'",
                fixture.orders.a_pending
            )
        )
        .await,
        Some(fixture.orders.a_pending.clone())
    );
    // 能力键不升级成租户作用域：订阅等租户数据一律读不到
    assert_eq!(count(&tx, "SELECT count(*) FROM subscription").await, 0);
    // 借来的读权限不能变成写权限
    let denied = exec_err(
        &tx,
        &format!(
            "UPDATE payment_order SET status = 'PAID' WHERE \"orderNo\" = '{}'",
            fixture.orders.a_pending
        ),
    )
    .await;
    assert!(denied.is_some(), "能力键不该允许写订单");
    tx.rollback().await.expect("回滚失败");

    // 归档订单连读都读不到
    let tx = fixture
        .storage
        .order_tx(&fixture.orders.a_archived)
        .await
        .expect("开启能力键事务失败");
    assert_eq!(count(&tx, "SELECT count(*) FROM payment_order").await, 0);
    tx.rollback().await.expect("回滚失败");

    // 伪造订单也写不进去（能力键没有 `WITH CHECK` 分支）
    let tx = fixture
        .storage
        .order_tx(&fixture.orders.a_pending)
        .await
        .expect("开启能力键事务失败");
    let denied = exec_err(
        &tx,
        &format!(
            r#"INSERT INTO payment_order
                 (id, "orderNo", "tenantID", "userID", plan, channel, amount, currency, status,
                  "expiresAt", "createdAt", "updatedAt")
               VALUES ('{}', 'PINJECT{suffix}', '{tenant}', '{user}', 'pro', 'WECHAT', 1, 'CNY',
                       'PENDING', now() + interval '1 day', now(), now())"#,
            Uuid::new_v4(),
            suffix = &fixture.orders.a_pending[2..],
            tenant = fixture.tenant_b,
            user = fixture.owner_b,
        ),
    )
    .await;
    assert!(denied.is_some(), "能力键不该允许插入订单");
    tx.rollback().await.expect("回滚失败");

    // 关掉确认：注入一个字都没落库
    assert_eq!(
        count(
            &fixture.admin,
            "SELECT count(*) FROM payment_order WHERE \"orderNo\" LIKE 'PINJECT%'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn a_paid_order_self_heals_its_subscription() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let mut ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let order = PaymentService::sync(
        &mut ctx,
        &fixture.storage,
        &fixture.config,
        &fixture.redis,
        &fixture.orders.a_paid,
    )
    .await
    .expect("已收款订单应当补齐订阅");
    assert_eq!(order.status, "PAID");
    let subscription_id = order.subscription_id.clone().expect("订单应当回写订阅 ID");
    ctx.commit().await.expect("提交失败");

    // 超级用户口径核对：订阅落了库，且是订单快照里的档位
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_a).await, 1);
    assert_eq!(
        scalar_text(
            &fixture.admin,
            &format!("SELECT plan FROM subscription WHERE id = '{subscription_id}'")
        )
        .await,
        Some("pro".to_string())
    );

    // 再查一次：幂等，不重复开通（同一个订单号只能换出一条订阅）
    let mut ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let again = PaymentService::sync(
        &mut ctx,
        &fixture.storage,
        &fixture.config,
        &fixture.redis,
        &fixture.orders.a_paid,
    )
    .await
    .expect("重复查单应当直接返回");
    ctx.commit().await.expect("提交失败");

    assert_eq!(again.subscription_id, Some(subscription_id));
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_a).await, 1);
}

#[tokio::test]
async fn an_expired_order_is_closed_and_the_closure_is_kept() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let mut ctx = enter(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let err = PaymentService::sync(
        &mut ctx,
        &fixture.storage,
        &fixture.config,
        &fixture.redis,
        &fixture.orders.a_expired,
    )
    .await
    .expect_err("过期订单应当被拒");
    assert!(matches!(err, PaymentError::OrderExpired));
    // 关单备注必须留痕：持有者据此提交而不是回滚（改造前这里写的是无作用域的池，0 行生效）
    assert!(err.keeps_writes(), "关单备注属于必须落库的写入");
    ctx.commit().await.expect("提交失败");

    assert_eq!(
        order_status(&fixture, &fixture.orders.a_expired).await,
        "CLOSED"
    );
    assert_eq!(
        order_remark(&fixture, &fixture.orders.a_expired).await,
        Some("超时未支付".to_string())
    );
    // 关单只落到本租户
    assert_eq!(
        order_status(&fixture, &fixture.orders.b_expired).await,
        "PENDING"
    );
    // 没有开通任何订阅：过期订单不产生配额
    assert_eq!(active_subscriptions(&fixture, fixture.tenant_a).await, 0);
}
