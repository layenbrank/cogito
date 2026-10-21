//! 平台特权通道（`cogito_platform` + `SET LOCAL ROLE`）与无租户行的端到端验证（P3d-1）。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test cargo test --test platform_scope
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 断言四条边界：
//! 1. 角色边界 —— `cogito_platform` 带 `BYPASSRLS` 且不可登录；应用角色不带，只能靠成员关系借用；
//! 2. 通道边界 —— 特权事务看得到所有租户，租户作用域与账号作用域看不到别的租户；
//! 3. 泄漏边界 —— `SET LOCAL ROLE` 是事务局部的：提交之后同一个池里的下一次操作又回到应用角色；
//! 4. 失败边界 —— 没有成员关系时不静默降级成「少看见几行」，而是明确报错。

use std::sync::LazyLock;
use std::time::Duration;

use identity::TenantId;
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, DbErr,
    QueryResult, Statement, TransactionTrait,
};
use cogito::databases::database::Storage;
use cogito::databases::scope::{PLATFORM_ROLE, apply_tenant_scope};
use cogito::guards::platform::PlatformScope;
use cogito::utils::db::is_row_security_violation;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 应用角色：非属主、无 `BYPASSRLS`，靠成员关系借用平台角色。
const APP_ROLE: &str = "cogito_app_test";

/// 对照角色：表权限齐全但**不是**平台角色的成员，用来验证提权失败是明确报错。
const NON_MEMBER_ROLE: &str = "cogito_app_outsider";

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    /// 超级用户连接：种数据、按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用角色的连接（服务层真实身份）。
    storage: Storage,
    /// 无平台成员关系的连接（只用于失败路径）。
    outsider: Storage,
    tenant_a: Uuid,
    tenant_b: Uuid,
}

/// 读取测试库地址；未配置或库名不合法时返回 `None`（调用方直接跳过）。
fn test_database_url() -> Option<String> {
    let uri = std::env::var("TEST_DATABASE_URL").ok()?;
    let uri = uri.trim().to_owned();
    if uri.is_empty() {
        return None;
    }
    let database = uri
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default();
    assert!(
        database.contains("test"),
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）：用例会重建库"
    );
    Some(uri)
}

/// 把测试库 URI 的账号换成指定角色，模拟真实部署下的连接身份。
fn role_uri(uri: &str, role: &str) -> String {
    let (scheme, rest) = uri
        .split_once("://")
        .expect("TEST_DATABASE_URL 需要带 scheme");
    let (_, host) = rest
        .rsplit_once('@')
        .expect("TEST_DATABASE_URL 需要带账号信息");

    format!("{scheme}://{role}:{role}@{host}")
}

fn database_of(uri: &str) -> String {
    let tail = uri.rsplit('/').next().unwrap_or_default();

    tail.split('?').next().unwrap_or_default().to_owned()
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

/// 执行一条**应当被拒**的语句，返回错误。
async fn exec_err<C: ConnectionTrait>(conn: &C, sql: &str) -> DbErr {
    conn.execute_unprepared(sql)
        .await
        .err()
        .unwrap_or_else(|| panic!("这条语句本应被拒：{sql}"))
}

async fn query_one<C: ConnectionTrait>(conn: &C, sql: &str) -> QueryResult {
    conn.query_one_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
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

fn role_flag(row: &QueryResult, index: usize) -> bool {
    row.try_get_by_index::<bool>(index)
        .expect("角色属性不是 boolean")
}

/// 重建库、建两个角色、授权、种两个租户的数据；锁未持有时不得调用。
async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let admin = connect(&uri, 2).await;

    migration::Migrator::fresh(&admin)
        .await
        .expect("重建测试库失败");

    for role in [APP_ROLE, NON_MEMBER_ROLE] {
        let exists = count(
            &admin,
            &format!("SELECT count(*) FROM pg_roles WHERE rolname = '{role}'"),
        )
        .await;
        if exists == 0 {
            exec(
                &admin,
                &format!(
                    "CREATE ROLE {role} LOGIN PASSWORD '{role}' \
                     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
                ),
            )
            .await;
        }
        // 授权按对象生效，每次重建后都会丢，所以放在 fresh 之后
        for sql in [
            format!("GRANT USAGE ON SCHEMA public TO {role}"),
            format!(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}"
            ),
            format!("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}"),
        ] {
            exec(&admin, &sql).await;
        }
    }

    // 迁移里由超级用户建好 `cogito_platform`；这里把成员关系拨到测试角色上
    exec(&admin, &format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}")).await;
    exec(
        &admin,
        &format!("REVOKE {PLATFORM_ROLE} FROM {NON_MEMBER_ROLE}"),
    )
    .await;

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(
            connect(&role_uri(&uri, APP_ROLE), 2).await,
            database_of(&uri),
        ),
        outsider: Storage::from_parts(
            connect(&role_uri(&uri, NON_MEMBER_ROLE), 2).await,
            database_of(&uri),
        ),
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
    };
    for (tag, tenant) in [("a", fixture.tenant_a), ("b", fixture.tenant_b)] {
        seed_tenant(&fixture.admin, tag, tenant).await;
    }
    Some(fixture)
}

/// 种一个租户的一行用量与一行审计：跨租户读写的对照物。
async fn seed_tenant(admin: &DatabaseConnection, tag: &str, tenant: Uuid) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    let user = Uuid::new_v4();
    exec(
        admin,
        &format!(
            r#"INSERT INTO auth (id, username, password, "createdAt", "updatedAt")
               VALUES ('{user}', 'platform-{suffix}-{tag}', '!', now(), now())"#
        ),
    )
    .await;
    exec(
        admin,
        &format!(
            r#"INSERT INTO tenant (id, name, slug, "createdAt", "updatedAt")
               VALUES ('{tenant}', 'Platform {tag}', 'platform-{suffix}-{tag}', now(), now())"#
        ),
    )
    .await;
    exec(
        admin,
        &format!(
            r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, "createdAt", "updatedAt")
               VALUES ('{}', '{tenant}', '{user}', 'OWNER', now(), now())"#,
            Uuid::new_v4()
        ),
    )
    .await;

    let provider = Uuid::new_v4();
    exec(admin, &format!(
        r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", "createdAt", "updatedAt", "tenantID")
           VALUES ('{provider}', 'OPENAI', 'provider-{suffix}-{tag}', 'https://api.openai.com/v1', now(), now(), '{tenant}')"#
    ))
    .await;
    let model = Uuid::new_v4();
    exec(admin, &format!(
        r#"INSERT INTO gateway_model (id, "providerID", name, label, "createdAt", "updatedAt", "tenantID")
           VALUES ('{model}', '{provider}', 'model-{suffix}-{tag}', 'Model {tag}', now(), now(), '{tenant}')"#
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
}

/// 平台角色由迁移就位：不可登录、带 `BYPASSRLS`；应用角色恰恰相反，只能靠成员关系借用。
#[tokio::test]
async fn platform_role_is_bypassrls_and_the_app_role_is_not() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let platform = query_one(
        &fixture.admin,
        &format!(
            "SELECT rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = '{PLATFORM_ROLE}'"
        ),
    )
    .await;
    assert!(
        role_flag(&platform, 0),
        "{PLATFORM_ROLE} 必须带 BYPASSRLS，否则特权通道形同虚设"
    );
    assert!(
        !role_flag(&platform, 1),
        "{PLATFORM_ROLE} 不能可登录：它只能被应用角色 SET ROLE 进入"
    );

    let app = query_one(
        &fixture.admin,
        &format!("SELECT rolbypassrls FROM pg_roles WHERE rolname = '{APP_ROLE}'"),
    )
    .await;
    assert!(
        !role_flag(&app, 0),
        "{APP_ROLE} 不能带 BYPASSRLS，否则租户隔离形同虚设"
    );

    assert_eq!(
        count(
            &fixture.admin,
            &format!(
                r#"SELECT count(*) FROM pg_auth_members m
                   JOIN pg_roles r ON r.oid = m.roleid
                   JOIN pg_roles g ON g.oid = m.member
                   WHERE r.rolname = '{PLATFORM_ROLE}' AND g.rolname = '{APP_ROLE}'"#
            )
        )
        .await,
        1,
        "{APP_ROLE} 应是 {PLATFORM_ROLE} 的成员，否则提权会失败"
    );
}

/// 特权事务看得到所有租户的行；同一个库上，租户作用域仍然只看得到自己。
#[tokio::test]
async fn platform_channel_sees_every_tenant() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("平台通道应可用（角色已就位）");
    for table in ["gateway_usage", "gateway_audit"] {
        assert_eq!(
            count(scope.tx(), &format!("SELECT count(*) FROM {table}")).await,
            2,
            "平台通道下 {table} 应看到两个租户的行"
        );
    }
    assert_eq!(
        scalar_text(scope.tx(), "SELECT current_user").await,
        PLATFORM_ROLE,
        "特权事务里当前角色应已是平台角色"
    );
    scope.rollback().await.expect("回滚失败");

    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户作用域失败");
    assert_eq!(
        count(&tx, "SELECT count(*) FROM gateway_usage").await,
        1,
        "租户作用域下用量仍只属于本租户"
    );
    tx.rollback().await.expect("回滚失败");
}

/// 平台目录的全局行（`"tenantID" IS NULL`）只能靠特权通道写；租户作用域写不进去，但读得到。
#[tokio::test]
async fn global_catalog_rows_are_written_through_the_platform_channel() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let provider = Uuid::new_v4();
    let insert = format!(
        r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", "createdAt", "updatedAt", "tenantID")
           VALUES ('{provider}', 'ANTHROPIC', 'builtin', 'https://api.anthropic.com/v1', now(), now(), NULL)"#
    );

    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户作用域失败");
    let err = exec_err(&tx, &insert).await;
    assert!(
        is_row_security_violation(&err),
        "租户作用域不得写全局行，错误应被识别为 RLS 违规，实际：{err}"
    );
    tx.rollback().await.expect("回滚失败");

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("平台通道应可用（角色已就位）");
    exec(scope.tx(), &insert).await;
    scope.commit().await.expect("提交失败");

    // 全局行对所有应用角色只读可见（内置目录），但看不见别的租户的目录行
    let tx = fixture.storage.raw().begin().await.expect("开启事务失败");
    assert_eq!(
        count(
            &tx,
            &format!(r#"SELECT count(*) FROM gateway_provider WHERE id = '{provider}'"#)
        )
        .await,
        1,
        "全局行应对所有身份可见"
    );
    assert_eq!(
        count(&tx, "SELECT count(*) FROM gateway_provider").await,
        1,
        "未设作用域时只应看到全局行"
    );
    tx.rollback().await.expect("回滚失败");
}

/// 提权是事务局部的：提交之后同一个连接池里的下一次操作又回到应用角色。
#[tokio::test]
async fn escalation_does_not_leak_past_the_transaction() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("平台通道应可用（角色已就位）");
    assert_eq!(
        count(scope.tx(), "SELECT count(*) FROM gateway_usage").await,
        2,
        "特权事务内应看到两个租户"
    );
    scope.commit().await.expect("提交失败");

    let tx = fixture.storage.raw().begin().await.expect("开启事务失败");
    assert_eq!(
        scalar_text(&tx, "SELECT current_user").await,
        APP_ROLE,
        "事务结束后角色应自动退回应用角色（池化连接不得残留提权）"
    );
    assert_eq!(
        count(&tx, "SELECT count(*) FROM gateway_usage").await,
        0,
        "未设作用域时用量读空：提权不得随连接留到下一位使用者"
    );
    tx.rollback().await.expect("回滚失败");
}

/// 没有成员关系时明确失败，而不是静默地少看见几行（fail-closed 且可诊断）。
#[tokio::test]
async fn platform_channel_fails_loudly_without_membership() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let err = PlatformScope::open(&fixture.outsider)
        .await
        .err()
        .expect("不是平台角色成员时不得开启特权事务");
    let message = err.to_string();
    assert!(
        message.contains("平台通道不可用"),
        "错误应指出是平台通道不可用，实际：{message}"
    );
    assert!(
        message.contains(PLATFORM_ROLE),
        "错误应点名缺失的角色，实际：{message}"
    );

    // 对照：同一时刻应用角色的通道依然可用，说明失败只取决于成员关系
    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("应用角色的平台通道应可用");
    assert_eq!(
        count(scope.tx(), "SELECT count(*) FROM gateway_usage").await,
        2,
        "特权事务内应看到两个租户"
    );
    scope.rollback().await.expect("回滚失败");
}

/// 作用域辅助函数与 RLS 策略保持同一口径：租户作用域下看不到别的租户（防止测试自身写错）。
#[tokio::test]
async fn tenant_scope_still_hides_other_tenants() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let tx = fixture.storage.raw().begin().await.expect("开启事务失败");
    apply_tenant_scope(&tx, TenantId::from_uuid(fixture.tenant_b))
        .await
        .expect("设置租户作用域失败");
    assert_eq!(
        count(&tx, "SELECT count(*) FROM gateway_usage").await,
        1,
        "租户 B 作用域下只应看到自己那一行"
    );
    assert_eq!(
        count(
            &tx,
            &format!(
                r#"SELECT count(*) FROM gateway_usage WHERE "tenantID" = '{}'"#,
                fixture.tenant_a
            )
        )
        .await,
        0,
        "租户 B 作用域下不应看到租户 A 的用量"
    );
    tx.rollback().await.expect("回滚失败");
}
