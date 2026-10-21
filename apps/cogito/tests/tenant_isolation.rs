//! 租户隔离（RLS）与 outbox 契约的端到端验证。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）且连接账号为超级用户：
//!
//! ```text
//! TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/cogito_service_test cargo test --test tenant_isolation
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 说明：单世代迁移策略下 schema 由 `000001_20260819` 整体重建，所以每个用例都会
//! `fresh` 一次；用例之间用全局锁串行，且该库不能被其他进程共用。

use std::sync::LazyLock;
use std::time::Duration;

use entity::consumed_event::ActiveModel as ConsumedEvent;
use entity::outbox::ActiveModel as Outbox;
use identity::{TenantId, UserId};
use migration::MigratorTrait;
use sea_orm::ActiveValue::{NotSet, Set};
use sea_orm::{
    ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, DatabaseBackend,
    DatabaseConnection, DatabaseTransaction, QueryResult, Statement, TransactionTrait,
};
use cogito::databases::scope::{
    TENANT_SETTING, USER_SETTING, apply_tenant_scope, apply_user_scope,
};
use cogito::utils::db::{is_row_security_violation, is_unique_violation};
use tokio::sync::Mutex;
use uuid::Uuid;

/// 隔离断言必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE，但角色侧也要对）。
const APP_ROLE: &str = "cogito_app_test";

/// 严格策略：只能看到本租户的行。
const STRICT_TABLES: [&str; 4] = ["outbox", "payment_order", "sso_connection", "subscription"];

/// 无租户行表：本租户行之外，还允许读到「自己没有租户的那一份」（`"tenantID" IS NULL` 且行归属本人）。
///
/// 新账号尚未建租户时用量与审计仍要落库（走全局配额），这些行没有租户可挂；
/// 放宽只在本人身上，跨账号照旧互不可见，租户作用域下也看不到。
const TENANTLESS_OWNER_TABLES: [&str; 2] = ["gateway_audit", "gateway_usage"];

/// 双作用域表：租户作用域 ∪ 账号自读（`userID = app_current_user_id()`）。
///
/// 账号作用域下这几张表只放宽「读自己的行」：租户作用域未设时同样读空，
/// 写入仍要求行落在当前租户作用域内，因此账号作用域是纯只读通道。
const SELF_VISIBLE_TABLES: [&str; 2] = ["tenant", "tenant_member"];

/// 目录表：`tenantID IS NULL` 表示内置全局行，对本租户只读可见。
const CATALOG_TABLES: [&str; 2] = ["gateway_model", "gateway_provider"];

/// 租户列是 text 的表（策略里显式 `::text`）。
const TEXT_TENANT_TABLES: [&str; 1] = ["asset"];

/// 带 `tenantID` 列、因此必须强制 RLS 的表（按 `relname` 排序）。
const FORCED_RLS_TABLES: [&str; 10] = [
    "asset",
    "gateway_audit",
    "gateway_model",
    "gateway_provider",
    "gateway_usage",
    "outbox",
    "payment_order",
    "sso_connection",
    "subscription",
    "tenant_member",
];

/// 作用域设为租户 A 后应看到的行数（`admin` 侧种子见 [`seed`]）。
const SCOPED_COUNTS: [(&str, i64); 11] = [
    ("tenant", 1),
    ("tenant_member", 1),
    ("subscription", 1),
    ("payment_order", 1),
    ("sso_connection", 1),
    ("gateway_usage", 1),
    ("gateway_audit", 1),
    ("outbox", 1),
    ("asset", 1),
    // 本租户行 + 全局行
    ("gateway_provider", 2),
    ("gateway_model", 2),
];

/// 不受作用域限制时应看到的总行数（证明种子确实是多租户混合的）。
const ADMIN_COUNTS: [(&str, i64); 11] = [
    ("tenant", 2),
    ("tenant_member", 2),
    ("subscription", 2),
    ("payment_order", 2),
    ("sso_connection", 2),
    ("gateway_usage", 2),
    ("gateway_audit", 2),
    // A + B + NULL 租户
    ("outbox", 3),
    ("asset", 2),
    ("gateway_provider", 3),
    ("gateway_model", 3),
];

/// outbox 列清单即事件契约：实体、消费者、下游都依赖它。
const OUTBOX_COLUMNS: [&str; 13] = [
    "id",
    "seq",
    "aggregate",
    "aggregateID",
    "eventType",
    "schemaVersion",
    "payload",
    "traceparent",
    "tenantID",
    "createdAt",
    "publishedAt",
    "attempts",
    "lastError",
];

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    admin: DatabaseConnection,
    app: DatabaseConnection,
    uri: String,
    tenant_a: Uuid,
    tenant_b: Uuid,
    user_a: Uuid,
    user_b: Uuid,
}

/// 读取测试库地址；未配置或库名不合法时返回 `None`（调用方直接跳过）。
fn test_database_url() -> Option<String> {
    let uri = std::env::var("TEST_DATABASE_URL").ok()?;
    let uri = uri.trim().to_owned();
    if uri.is_empty() {
        return None;
    }
    let database = uri.rsplit('/').next().unwrap_or_default();
    let database = database.split('?').next().unwrap_or_default();
    assert!(
        database.contains("test"),
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）：用例会重建库"
    );
    Some(uri)
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

/// 执行只返回一行的查询；行数/类型不符即失败。
async fn query_one<C: ConnectionTrait>(conn: &C, sql: &str) -> QueryResult {
    conn.query_one_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
}

async fn query_all<C: ConnectionTrait>(conn: &C, sql: &str) -> Vec<QueryResult> {
    conn.query_all_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
}

async fn count<C: ConnectionTrait>(conn: &C, sql: &str) -> i64 {
    query_one(conn, sql)
        .await
        .try_get_by_index::<i64>(0)
        .expect("结果不是 bigint")
}

async fn scalar_text<C: ConnectionTrait>(conn: &C, sql: &str) -> String {
    query_one(conn, sql)
        .await
        .try_get_by_index::<String>(0)
        .expect("结果不是 text")
}

/// 在应用连接上开启事务并 `SET ROLE` 到非属主角色。
/// 事务内的 `SET ROLE` 在提交/回滚后自动还原，不会污染池化连接。
async fn app_tx(fixture: &Fixture) -> DatabaseTransaction {
    let tx = fixture.app.begin().await.expect("开启事务失败");
    exec(&tx, &format!("SET ROLE {APP_ROLE}")).await;
    assert_eq!(
        scalar_text(&tx, "SELECT current_user").await,
        APP_ROLE,
        "隔离断言必须运行在非属主角色下"
    );
    let bypass = query_one(
        &tx,
        &format!("SELECT rolbypassrls FROM pg_roles WHERE rolname = '{APP_ROLE}'"),
    )
    .await
    .try_get_by_index::<bool>(0)
    .expect("rolbypassrls 取值失败");
    assert!(!bypass, "{APP_ROLE} 不能带 BYPASSRLS，否则隔离测试形同虚设");
    tx
}

/// 进入指定租户的作用域（RLS 策略读的就是它）。
async fn scope_tenant<C: ConnectionTrait>(conn: &C, tenant: Uuid) {
    apply_tenant_scope(conn, TenantId::from_uuid(tenant))
        .await
        .expect("设置租户作用域失败");
}

/// 进入账号作用域（跨租户只读自己）。
async fn scope_user<C: ConnectionTrait>(conn: &C, user: Uuid) {
    apply_user_scope(conn, UserId::from_uuid(user))
        .await
        .expect("设置账号作用域失败");
}

/// 重建库、建角色、授权、种数据；锁未持有时不得调用。
async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let admin = connect(&uri, 4).await;
    let app = connect(&uri, 2).await;

    // 顺带验证 outbox / consumed_event 能随迁移重建
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
        app,
        uri,
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
        user_a: Uuid::new_v4(),
        user_b: Uuid::new_v4(),
    };
    seed(&fixture).await;
    Some(fixture)
}

/// 种两个租户的全量数据：跨租户读取/写入的对照组。
async fn seed(fixture: &Fixture) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];

    for (tag, tenant, user) in [
        ("a", fixture.tenant_a, fixture.user_a),
        ("b", fixture.tenant_b, fixture.user_b),
    ] {
        let admin = &fixture.admin;
        exec(
            admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, "createdAt", "updatedAt")
               VALUES ('{user}', 'rls-{suffix}-{tag}', '!', now(), now())"#
            ),
        )
        .await;
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, "createdAt", "updatedAt")
               VALUES ('{tenant}', 'RLS {tag}', 'rls-{suffix}-{tag}', now(), now())"#
            ),
        )
        .await;
        exec(admin, &format!(
            r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, "createdAt", "updatedAt")
               VALUES ('{}', '{tenant}', '{user}', 'OWNER', now(), now())"#,
            Uuid::new_v4()
        ))
        .await;
        exec(
            admin,
            &format!(
                r#"INSERT INTO subscription (id, "tenantID", plan, "createdAt", "updatedAt")
               VALUES ('{}', '{tenant}', 'PRO', now(), now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
        exec(admin, &format!(
            r#"INSERT INTO payment_order (id, "orderNo", "tenantID", "userID", plan, channel, amount, "expiresAt", "createdAt", "updatedAt")
               VALUES ('{}', 'RLS-{suffix}-{tag}', '{tenant}', '{user}', 'PRO', 'WECHAT', 100,
                       now() + interval '1 day', now(), now())"#,
            Uuid::new_v4()
        ))
        .await;
        exec(admin, &format!(
            r#"INSERT INTO sso_connection (id, "tenantID", provider, issuer, "clientID", "redirectUri", "createdAt", "updatedAt")
               VALUES ('{}', '{tenant}', 'OIDC', 'https://idp.example.com', 'client-{tag}',
                       'https://app.example.com/cb', now(), now())"#,
            Uuid::new_v4()
        ))
        .await;

        let provider = Uuid::new_v4();
        exec(admin, &format!(
            r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", "createdAt", "updatedAt", "tenantID")
               VALUES ('{provider}', 'OPENAI', 'provider-{tag}', 'https://api.openai.com/v1', now(), now(), '{tenant}')"#
        ))
        .await;
        let model = Uuid::new_v4();
        exec(admin, &format!(
            r#"INSERT INTO gateway_model (id, "providerID", name, label, "createdAt", "updatedAt", "tenantID")
               VALUES ('{model}', '{provider}', 'model-{tag}', 'Model {tag}', now(), now(), '{tenant}')"#
        ))
        .await;
        exec(admin, &format!(
            r#"INSERT INTO gateway_usage (id, "tenantID", "userID", "providerID", "modelID", status, "createdAt")
               VALUES ('{}', '{tenant}', '{user}', '{provider}', '{model}', 'SUCCESS', now())"#,
            Uuid::new_v4()
        ))
        .await;
        exec(
            admin,
            &format!(
                r#"INSERT INTO gateway_audit (id, "tenantID", actor, action, resource, "createdAt")
               VALUES ('{}', '{tenant}', '{user}', 'gateway.invoke', 'model-{tag}', now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
        exec(admin, &format!(
            r#"INSERT INTO asset (id, hash, size, mime, name, status, chunk, total, "createdAt", "updatedAt", "tenantID")
               VALUES ('{}', 'hash-{suffix}-{tag}', 1024, 'image/png', 'a-{tag}.png', 'READY', 1, 1,
                       now(), now(), '{tenant}')"#,
            Uuid::new_v4()
        ))
        .await;
    }

    // 内置全局目录行（`tenantID IS NULL`）
    let global_provider = Uuid::new_v4();
    exec(&fixture.admin, &format!(
        r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", "createdAt", "updatedAt", "tenantID")
           VALUES ('{global_provider}', 'OPENAI', 'builtin', 'https://api.openai.com/v1', now(), now(), NULL)"#
    ))
    .await;
    exec(&fixture.admin, &format!(
        r#"INSERT INTO gateway_model (id, "providerID", name, label, "createdAt", "updatedAt", "tenantID")
           VALUES ('{}', '{global_provider}', 'builtin-model', 'Builtin', now(), now(), NULL)"#,
        Uuid::new_v4()
    ))
    .await;

    // outbox：两个租户各一条 + 一条无租户事件（后者对任何租户都必须不可见）
    for (tenant, tag) in [
        (Some(fixture.tenant_a), "a"),
        (Some(fixture.tenant_b), "b"),
        (None, "global"),
    ] {
        let tenant = match tenant {
            Some(id) => format!("'{id}'"),
            None => "NULL".to_owned(),
        };
        exec(&fixture.admin, &format!(
            r#"INSERT INTO outbox (id, aggregate, "aggregateID", "eventType", "schemaVersion", payload, "tenantID", "createdAt")
               VALUES ('{}', 'subscription', '{}', 'subscription.renewed', 1,
                       jsonb_build_object('tag', '{tag}'), {tenant}, now())"#,
            Uuid::new_v4(),
            Uuid::new_v4()
        ))
        .await;
    }
}

#[tokio::test]
async fn scoped_reads_are_limited_to_the_current_tenant() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    for (table, expected) in ADMIN_COUNTS {
        assert_eq!(
            count(&fixture.admin, &format!("SELECT count(*) FROM {table}")).await,
            expected,
            "特权连接视角下 {table} 的行数（种子数据应为多租户混合）"
        );
    }

    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    for (table, expected) in SCOPED_COUNTS {
        assert_eq!(
            count(&tx, &format!("SELECT count(*) FROM {table}")).await,
            expected,
            "租户 A 作用域下 {table} 的可见行数"
        );
    }
    assert_eq!(
        count(
            &tx,
            &format!(
                r#"SELECT count(*) FROM subscription WHERE "tenantID" = '{}'"#,
                fixture.tenant_b
            )
        )
        .await,
        0,
        "租户 A 不应看到租户 B 的订阅"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn unset_scope_reads_nothing() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    // 作用域未设置时 `app_current_tenant_id()` / `app_current_user_id()` 均为 NULL，
    // 受保护的表全部读空（fail-closed）
    for table in STRICT_TABLES
        .iter()
        .chain(TEXT_TENANT_TABLES.iter())
        .chain(SELF_VISIBLE_TABLES.iter())
        .chain(TENANTLESS_OWNER_TABLES.iter())
    {
        assert_eq!(
            count(&tx, &format!("SELECT count(*) FROM {table}")).await,
            0,
            "未设作用域时 {table} 不应可读"
        );
    }
    // 目录表只暴露内置全局行
    for table in CATALOG_TABLES {
        assert_eq!(
            count(&tx, &format!("SELECT count(*) FROM {table}")).await,
            1,
            "未设作用域时 {table} 只应可见全局行"
        );
    }
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn user_scope_reads_own_rows_only() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_user(&tx, fixture.user_a).await;
    assert_eq!(
        scalar_text(&tx, "SELECT id::text FROM tenant").await,
        fixture.tenant_a.to_string(),
        "账号作用域只应看到自己加入的租户"
    );
    assert_eq!(
        count(&tx, "SELECT count(*) FROM tenant_member").await,
        1,
        "账号作用域只应看到自己的成员行"
    );
    assert_eq!(
        count(&tx, "SELECT count(*) FROM subscription").await,
        0,
        "账号作用域不放开租户内其他数据"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn user_scope_cannot_write_tenant_data() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_user(&tx, fixture.user_a).await;
    let err = tx
        .execute_unprepared(&format!(
            r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, "createdAt", "updatedAt")
               VALUES ('{}', '{}', '{}', 'MEMBER', now(), now())"#,
            Uuid::new_v4(),
            fixture.tenant_a,
            fixture.user_a
        ))
        .await
        .err()
        .expect("账号作用域不得写入租户数据");
    assert!(
        is_row_security_violation(&err),
        "错误应被识别为 RLS 违规，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");
}

/// 无租户行只归本人：账号作用域能读能写自己那份，别人的与租户作用域都碰不到。
#[tokio::test]
async fn tenantless_rows_belong_to_the_account_alone() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let model = scalar_text(
        &fixture.admin,
        r#"SELECT id::text FROM gateway_model WHERE "tenantID" IS NOT NULL LIMIT 1"#,
    )
    .await;
    let provider = scalar_text(
        &fixture.admin,
        &format!(r#"SELECT "providerID"::text FROM gateway_model WHERE id = '{model}'"#),
    )
    .await;

    // 两个账号各一条无租户用量与审计：账号还没建租户时走全局配额，这些行没有租户可挂
    for (user, tag) in [(fixture.user_a, "a"), (fixture.user_b, "b")] {
        exec(&fixture.admin, &format!(
            r#"INSERT INTO gateway_usage (id, "tenantID", "userID", "providerID", "modelID", status, "createdAt")
               VALUES ('{}', NULL, '{user}', '{provider}', '{model}', 'SUCCESS', now())"#,
            Uuid::new_v4()
        ))
        .await;
        exec(
            &fixture.admin,
            &format!(
                r#"INSERT INTO gateway_audit (id, "tenantID", actor, action, resource, "createdAt")
               VALUES ('{}', NULL, '{user}', 'gateway.invoke', 'tenantless-{tag}', now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
    }

    // 租户作用域看不见任何无租户行：它不属于任何租户
    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    for table in TENANTLESS_OWNER_TABLES {
        assert_eq!(
            count(&tx, &format!("SELECT count(*) FROM {table}")).await,
            1,
            "租户 A 作用域下 {table} 只应看到本租户行"
        );
    }
    tx.rollback().await.expect("回滚失败");

    // 账号作用域只看到自己那一份
    let tx = app_tx(&fixture).await;
    scope_user(&tx, fixture.user_a).await;
    for table in TENANTLESS_OWNER_TABLES {
        assert_eq!(
            count(&tx, &format!("SELECT count(*) FROM {table}")).await,
            1,
            "账号作用域下 {table} 只应看到自己的无租户行"
        );
    }
    exec(
        &tx,
        &format!(
            r#"INSERT INTO gateway_usage (id, "tenantID", "userID", "providerID", "modelID", status, "createdAt")
               VALUES ('{}', NULL, '{}', '{provider}', '{model}', 'SUCCESS', now())"#,
            Uuid::new_v4(),
            fixture.user_a
        ),
    )
    .await;
    let err = tx
        .execute_unprepared(&format!(
            r#"INSERT INTO gateway_usage (id, "tenantID", "userID", "providerID", "modelID", status, "createdAt")
               VALUES ('{}', NULL, '{}', '{provider}', '{model}', 'SUCCESS', now())"#,
            Uuid::new_v4(),
            fixture.user_b
        ))
        .await
        .err()
        .expect("账号作用域不得替别的账号记用量");
    assert!(
        is_row_security_violation(&err),
        "错误应被识别为 RLS 违规，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn new_tenant_is_created_inside_its_own_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 建租户的路径：作用域先指向尚不存在的新标识，租户与首条成员关系都落在它里面
    let new_tenant = Uuid::new_v4();
    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, new_tenant).await;
    exec(
        &tx,
        &format!(
            r#"INSERT INTO tenant (id, name, slug, "createdAt", "updatedAt")
               VALUES ('{new_tenant}', '新建租户', 'scoped-{}', now(), now())"#,
            &new_tenant.simple().to_string()[..8]
        ),
    )
    .await;
    exec(
        &tx,
        &format!(
            r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, "createdAt", "updatedAt")
               VALUES ('{}', '{new_tenant}', '{}', 'OWNER', now(), now())"#,
            Uuid::new_v4(),
            fixture.user_a
        ),
    )
    .await;
    assert_eq!(
        count(&tx, "SELECT count(*) FROM tenant").await,
        1,
        "新租户的作用域里只有它自己"
    );
    assert_eq!(
        count(
            &tx,
            &format!(
                r#"SELECT count(*) FROM tenant WHERE id = '{}'"#,
                fixture.tenant_a
            )
        )
        .await,
        0,
        "新租户的作用域里不应看到别的租户"
    );
    tx.rollback().await.expect("回滚失败");

    assert_eq!(
        count(
            &fixture.admin,
            &format!(r#"SELECT count(*) FROM tenant WHERE id = '{new_tenant}'"#)
        )
        .await,
        0,
        "回滚后不应留下没有所有者的租户"
    );
}

#[tokio::test]
async fn tenant_row_cannot_be_created_outside_its_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    let err = tx
        .execute_unprepared(&format!(
            r#"INSERT INTO tenant (id, name, slug, "createdAt", "updatedAt")
               VALUES ('{}', '伪造租户', 'forged-{}', now(), now())"#,
            fixture.tenant_b,
            Uuid::new_v4().simple()
        ))
        .await
        .err()
        .expect("不得在当前作用域外插入租户");
    assert!(
        is_row_security_violation(&err),
        "错误应被识别为 RLS 违规，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn cross_tenant_insert_is_rejected() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    let err = tx
        .execute_unprepared(&format!(
            r#"INSERT INTO subscription (id, "tenantID", plan, "createdAt", "updatedAt")
               VALUES ('{}', '{}', 'PRO', now(), now())"#,
            Uuid::new_v4(),
            fixture.tenant_b
        ))
        .await
        .err()
        .expect("跨租户写入必须被拒绝");
    assert!(
        is_row_security_violation(&err),
        "错误应被识别为 RLS 违规，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn tenant_cannot_write_global_catalog_rows() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    let err = tx
        .execute_unprepared(&format!(
            r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", "createdAt", "updatedAt", "tenantID")
               VALUES ('{}', 'OPENAI', 'forged', 'https://evil.example.com', now(), now(), NULL)"#,
            Uuid::new_v4()
        ))
        .await
        .err()
        .expect("普通租户不得写入全局目录行");
    assert!(
        is_row_security_violation(&err),
        "错误应被识别为 RLS 违规，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn cross_tenant_update_affects_nothing() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    let result = tx
        .execute_unprepared(&format!(
            r#"UPDATE subscription SET plan = 'ENTERPRISE' WHERE "tenantID" = '{}'"#,
            fixture.tenant_b
        ))
        .await
        .expect("跨租户 UPDATE 语句本身不应报错");
    assert_eq!(result.rows_affected(), 0, "跨租户 UPDATE 不应影响任何行");
    tx.rollback().await.expect("回滚失败");

    assert_eq!(
        count(
            &fixture.admin,
            &format!(
                r#"SELECT count(*) FROM subscription WHERE "tenantID" = '{}' AND plan = 'ENTERPRISE'"#,
                fixture.tenant_b
            )
        )
        .await,
        0,
        "租户 B 的订阅不应被改动"
    );
}

#[tokio::test]
async fn own_tenant_insert_succeeds() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    // gateway_audit 是追加型表（无唯一约束），用它验证 `WITH CHECK` 对本租户放行
    let id = Uuid::new_v4();
    exec(
        &tx,
        &format!(
            r#"INSERT INTO gateway_audit (id, "tenantID", actor, action, resource, "createdAt")
               VALUES ('{id}', '{}', '{}', 'gateway.invoke', 'self', now())"#,
            fixture.tenant_a, fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(
        count(
            &tx,
            &format!(r#"SELECT count(*) FROM gateway_audit WHERE id = '{id}'"#)
        )
        .await,
        1,
        "本租户写入必须成功且立即可见"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn scope_is_transaction_local() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 只允许一条连接：下面两个事务必然落在同一个会话上，才能验证作用域不会跨事务残留
    let single = connect(&fixture.uri, 1).await;
    let tx = single.begin().await.expect("开启事务失败");
    exec(&tx, &format!("SET ROLE {APP_ROLE}")).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    scope_user(&tx, fixture.user_a).await;
    assert_eq!(
        count(&tx, "SELECT count(*) FROM subscription").await,
        1,
        "事务内作用域应生效"
    );
    tx.commit().await.expect("提交失败");

    let tx = single.begin().await.expect("开启事务失败");
    exec(&tx, &format!("SET ROLE {APP_ROLE}")).await;
    assert_ne!(
        scalar_text(
            &tx,
            &format!("SELECT coalesce(current_setting('{TENANT_SETTING}', true), '<unset>')")
        )
        .await,
        fixture.tenant_a.to_string(),
        "会话变量残留租户 ID 会导致池化连接串租户"
    );
    assert_ne!(
        scalar_text(
            &tx,
            &format!("SELECT coalesce(current_setting('{USER_SETTING}', true), '<unset>')")
        )
        .await,
        fixture.user_a.to_string(),
        "会话变量残留用户 ID 会让租户成员表多出可见行"
    );
    assert_eq!(
        scalar_text(
            &tx,
            "SELECT coalesce(app_current_tenant_id()::text, '<none>')"
        )
        .await,
        "<none>",
        "提交后 `app_current_tenant_id()` 必须回到 NULL，后续请求才不会读到上一个租户的数据"
    );
    assert_eq!(
        count(&tx, "SELECT count(*) FROM subscription").await,
        0,
        "提交后作用域必须失效"
    );
    tx.rollback().await.expect("回滚失败");
}

#[tokio::test]
async fn every_tenant_scoped_table_enforces_rls() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 元规则：只要表带 `tenantID` 列就必须强制 RLS 且恰好一条策略
    let rows = query_all(
        &fixture.admin,
        r#"SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                  (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND EXISTS (
                 SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attname = 'tenantID' AND a.attnum > 0
                   AND NOT a.attisdropped
             )
           ORDER BY c.relname"#,
    )
    .await;
    let mut names = Vec::new();
    for row in &rows {
        let name: String = row.try_get_by_index(0).expect("relname");
        let enabled: bool = row.try_get_by_index(1).expect("relrowsecurity");
        let forced: bool = row.try_get_by_index(2).expect("relforcerowsecurity");
        let policies: i64 = row.try_get_by_index(3).expect("策略数量");
        assert!(enabled, "{name} 未开启 RLS");
        assert!(forced, "{name} 未 FORCE RLS：表属主连接会绕过策略");
        assert_eq!(policies, 1, "{name} 应有且仅有一条策略");
        names.push(name);
    }
    assert_eq!(
        names, FORCED_RLS_TABLES,
        "带 tenantID 列的表清单与预期不一致"
    );

    // tenant 表用主键自证，没有 tenantID 列但同样必须强制隔离
    assert_eq!(
        count(
            &fixture.admin,
            r#"SELECT count(*) FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'tenant'
                 AND c.relrowsecurity AND c.relforcerowsecurity
                 AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1"#
        )
        .await,
        1,
        "tenant 表必须强制 RLS"
    );

    // auth 是全局身份、chunk 是派生数据：误开 RLS 会导致登录/切片查不到数据
    assert_eq!(
        count(
            &fixture.admin,
            r#"SELECT count(*) FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname IN ('auth', 'chunk')
                 AND c.relrowsecurity"#
        )
        .await,
        0,
        "auth / chunk 不应开启 RLS"
    );
}

#[tokio::test]
async fn outbox_and_consumed_event_are_rebuildable() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let columns: Vec<String> = query_all(
        &fixture.admin,
        "SELECT column_name FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'outbox' ORDER BY ordinal_position",
    )
    .await
    .iter()
    .map(|row| row.try_get_by_index::<String>(0).expect("column_name"))
    .collect();
    assert_eq!(
        columns, OUTBOX_COLUMNS,
        "outbox 列清单是事件契约，变更需同步实体与消费者"
    );
    assert_eq!(
        scalar_text(
            &fixture.admin,
            "SELECT is_identity FROM information_schema.columns \
             WHERE table_schema = 'public' AND table_name = 'outbox' AND column_name = 'seq'"
        )
        .await,
        "YES",
        "seq 必须是数据库分配的 identity：发布游标依赖它的单调性"
    );
    assert_eq!(
        scalar_text(
            &fixture.admin,
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint \
             WHERE conrelid = 'consumed_event'::regclass AND contype = 'p'"
        )
        .await,
        r#"PRIMARY KEY (consumer, "eventID")"#,
        "消费幂等键必须是 (consumer, eventID)"
    );

    // 用实体写入：验证字段映射、数据库分配的 seq、jsonb 负载往返、幂等键冲突可识别
    let tx = app_tx(&fixture).await;
    scope_tenant(&tx, fixture.tenant_a).await;
    let event_id = Uuid::new_v4();
    let row = Outbox {
        id: Set(event_id),
        seq: NotSet,
        aggregate: Set("subscription".to_owned()),
        aggregate_id: Set(fixture.tenant_a),
        event_type: Set("subscription.renewed".to_owned()),
        schema_version: Set(1),
        payload: Set(serde_json::json!({ "plan": "TEAM" })),
        traceparent: Set(None),
        tenant_id: Set(Some(fixture.tenant_a)),
        created_at: Set(chrono::Utc::now().fixed_offset()),
        published_at: Set(None),
        attempts: Set(0),
        last_error: Set(None),
    }
    .insert(&tx)
    .await
    .expect("outbox 写入失败");
    assert_eq!(row.id, event_id);
    assert!(row.seq > 0, "seq 应由数据库分配，实际：{}", row.seq);
    assert_eq!(row.payload, serde_json::json!({ "plan": "TEAM" }));
    assert!(row.published_at.is_none());
    assert_eq!(row.attempts, 0);

    let consumed = ConsumedEvent {
        consumer: Set("subscription".to_owned()),
        event_id: Set(event_id),
        consumed_at: Set(chrono::Utc::now().fixed_offset()),
    }
    .insert(&tx)
    .await
    .expect("consumed_event 写入失败");
    assert_eq!(consumed.event_id, event_id);

    let err = ConsumedEvent {
        consumer: Set("subscription".to_owned()),
        event_id: Set(event_id),
        consumed_at: Set(chrono::Utc::now().fixed_offset()),
    }
    .insert(&tx)
    .await
    .err()
    .expect("重复消费必须被幂等键挡住");
    assert!(
        is_unique_violation(&err),
        "错误应被识别为唯一约束冲突，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");
}
