//! 网关服务的作用域端到端验证（P3d-2）。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test cargo test --test gateway_scope
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 网关是三种身份都要落地的模块，因此断言按「谁开作用域」分三层：
//!
//! 1. **平台面**（`PlatformScope`）——看到全局目录行与所有租户的用量/审计；写只写全局行，
//!    改/删租户行必须报 404（旧实现走无作用域连接，一行都看不见却「静默成功」）；
//! 2. **租户面**（`TenantCtx`）——只看到本租户私有行 + 全局行；
//! 3. **账号面**（`AccountScope`）——没有租户时只看到全局行，落库只落「本人无租户」的行。
//!
//! 用例跑在非属主角色 `cogito_app_test` 上：属主会绕过策略，那样测不出东西。

use std::sync::LazyLock;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use identity::{PlatformRole, Principal, TenantId, UserId};
use migration::MigratorTrait;
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection};
use serde_json::json;
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::guards::account::AccountScope;
use cogito::guards::platform::PlatformScope;
use cogito::guards::session::Session;
use cogito::guards::tenant::{TenantCtx, TenantScope};
use cogito::services::gateway::render;
use cogito::services::gateway::repository::{UsageInput, record_audit, record_usage};
use cogito::services::gateway::schema::{
    AuditExportFormat, AuditFilter, ModelR, ModelWriteP, ProviderUpdateP, ProviderWriteP,
    UsageQueryP,
};
use cogito::services::gateway::service::{GatewayError, GatewayService};
use cogito::utils::db::is_row_security_violation;
use cogito::utils::jwt::Claims;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 隔离断言必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE，第 1 个用例会复核）。
const APP_ROLE: &str = "cogito_app_test";

/// 远超测试生命周期的过期时间（2100-01-01），避免用例受系统时钟影响。
const FAR_FUTURE_EXP: i64 = 4_102_444_800;

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    /// 超级用户连接：种数据、按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用连接（非属主角色，靠成员关系借用平台角色）：服务层唯一的数据入口。
    storage: Storage,
    config: Configure,
    tenant_a: Uuid,
    tenant_b: Uuid,
    owner_a: UserId,
    owner_b: UserId,
    /// 全局供应商 / 全局模型（`tenantID IS NULL`，平台目录）。
    provider_global: Uuid,
    model_global: Uuid,
    /// `tenant_a` 的私有供应商 / 私有模型。
    provider_a: Uuid,
    model_a: Uuid,
    /// `tenant_b` 的私有模型。
    model_b: Uuid,
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

/// 重建库、建应用角色、授权、种两个租户的目录与用量；锁未持有时不得调用。
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
    // 迁移里由超级用户建好 `cogito_platform`；平台面用例靠成员关系借用它
    exec(&admin, &format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}")).await;

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(connect(&app_uri(&uri), 2).await, database_of(&uri)),
        config: Configure::default(),
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
        owner_a: UserId::generate(),
        owner_b: UserId::generate(),
        provider_global: Uuid::new_v4(),
        model_global: Uuid::new_v4(),
        provider_a: Uuid::new_v4(),
        model_a: Uuid::new_v4(),
        model_b: Uuid::new_v4(),
    };
    seed(&fixture).await;
    Some(fixture)
}

/// 两个租户各一名 OWNER、一个全局供应商 + 全局模型、各自一条私有模型；A 另有一条私有供应商。
async fn seed(fixture: &Fixture) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    let admin = &fixture.admin;

    for (tag, user) in [("a", fixture.owner_a), ("b", fixture.owner_b)] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{user}', 'gw-{suffix}-{tag}', '!', 'USER', 'ACTIVE', now(), now())"#
            ),
        )
        .await;
    }

    for (tag, tenant) in [("a", fixture.tenant_a), ("b", fixture.tenant_b)] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
                   VALUES ('{tenant}', 'Gateway {tag}', 'gw-{suffix}-{tag}', 'ACTIVE', 'PERSONAL', now(), now())"#
            ),
        )
        .await;
    }

    for (tenant, user) in [
        (fixture.tenant_a, fixture.owner_a),
        (fixture.tenant_b, fixture.owner_b),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
                   VALUES ('{}', '{tenant}', '{user}', 'OWNER', 'ACTIVE', now(), now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
    }

    // 全局行：`tenantID IS NULL`，只有平台特权作用域写得进、所有作用域都读得到
    exec(admin, &format!(
        r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", status, "createdAt", "updatedAt", "tenantID")
           VALUES ('{}', 'OPENAI', 'gw-global-{suffix}', 'https://api.openai.com/v1', 'ACTIVE', now(), now(), NULL)"#,
        fixture.provider_global
    ))
    .await;
    exec(admin, &format!(
        r#"INSERT INTO gateway_model (id, "providerID", name, label, enabled, "createdAt", "updatedAt", "tenantID")
           VALUES ('{}', '{}', 'global-{suffix}', 'Global', true, now(), now(), NULL)"#,
        fixture.model_global, fixture.provider_global
    ))
    .await;

    // 租户私有行：只对本租户可见
    exec(admin, &format!(
        r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", status, "createdAt", "updatedAt", "tenantID")
           VALUES ('{}', 'DEEPSEEK', 'gw-a-{suffix}', 'https://api.deepseek.com', 'ACTIVE', now(), now(), '{}')"#,
        fixture.provider_a, fixture.tenant_a
    ))
    .await;
    for (model, provider, tenant, tag) in [
        (fixture.model_a, fixture.provider_a, fixture.tenant_a, "a"),
        (
            fixture.model_b,
            fixture.provider_global,
            fixture.tenant_b,
            "b",
        ),
    ] {
        exec(admin, &format!(
            r#"INSERT INTO gateway_model (id, "providerID", name, label, enabled, "createdAt", "updatedAt", "tenantID")
               VALUES ('{model}', '{provider}', 'private-{suffix}-{tag}', 'Private {tag}', true, now(), now(), '{tenant}')"#
        ))
        .await;
    }

    // 两个租户各一行用量与审计：跨租户可见性的对照物
    for (tenant, user) in [
        (fixture.tenant_a, fixture.owner_a),
        (fixture.tenant_b, fixture.owner_b),
    ] {
        exec(admin, &format!(
            r#"INSERT INTO gateway_usage (id, "tenantID", "userID", "providerID", "modelID", status, "createdAt")
               VALUES ('{}', '{tenant}', '{user}', '{}', '{}', 'SUCCESS', now())"#,
            Uuid::new_v4(), fixture.provider_global, fixture.model_global
        ))
        .await;
        exec(
            admin,
            &format!(
                r#"INSERT INTO gateway_audit (id, "tenantID", actor, action, resource, "createdAt")
                   VALUES ('{}', '{tenant}', '{user}', 'gateway.invoke', 'model', now())"#,
                Uuid::new_v4()
            ),
        )
        .await;
    }
}

async fn session_of(fixture: &Fixture, user: UserId) -> Session {
    let claims = Claims {
        sub: user.to_string(),
        username: "gateway".to_owned(),
        role: "USER".to_owned(),
        exp: FAR_FUTURE_EXP,
        iat: FAR_FUTURE_EXP - 3600,
    };
    Session::resolve(&fixture.storage, &claims, &format!("gw-token-{user}"))
        .await
        .expect("建立会话失败")
}

async fn enter_tenant(fixture: &Fixture, user: UserId, tenant: Uuid) -> TenantCtx {
    let session = session_of(fixture, user).await;

    TenantCtx::enter(&fixture.storage, &session, TenantId::from_uuid(tenant))
        .await
        .expect("进入租户作用域失败")
}

fn usage_input(tenant: Option<Uuid>, user: UserId, fixture: &Fixture) -> UsageInput {
    UsageInput {
        tenant_id: tenant,
        user_id: user.as_uuid(),
        provider_id: fixture.provider_global,
        model_id: fixture.model_global,
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        status: "SUCCESS".to_owned(),
        latency_ms: 12,
    }
}

fn model_names(models: &[ModelR]) -> Vec<String> {
    models.iter().map(|m| m.name.clone()).collect()
}

/// 空更新：改平台面里的租户行应在「找不到」处就短路，不必构造真实字段。
fn provider_update() -> ProviderUpdateP {
    serde_json::from_value(json!({})).expect("构造 ProviderUpdateP 失败")
}

fn provider_write(name: &str) -> ProviderWriteP {
    serde_json::from_value(json!({
        "kind": "openai",
        "name": name,
        "baseUrl": "https://api.openai.com/v1"
    }))
    .expect("构造 ProviderWriteP 失败")
}

fn model_write(provider_id: Uuid, name: &str) -> ModelWriteP {
    serde_json::from_value(json!({
        "providerID": provider_id.to_string(),
        "name": name,
        "label": "Platform"
    }))
    .expect("构造 ModelWriteP 失败")
}

/// 平台面：全局目录写得进、读得到；跨租户用量/审计看得到（这正是提权的用途）。
#[tokio::test]
async fn platform_scope_reaches_global_catalog_and_cross_tenant_usage() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("进入平台特权作用域失败");

    let providers = GatewayService::list_providers(&scope)
        .await
        .expect("列举平台供应商失败");
    assert_eq!(
        providers.len(),
        1,
        "平台目录只认全局行：租户私有供应商不得出现在平台列表里"
    );
    assert_eq!(providers[0].id, fixture.provider_global.to_string());

    let models = GatewayService::list_models_admin(&scope)
        .await
        .expect("列举平台模型失败");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, fixture.model_global.to_string());

    // 用量与审计：平台面要看到**所有**租户的行，否则运维汇总无从统计
    let (usage, usage_total) = GatewayService::list_usage(
        &scope,
        UsageQueryP {
            tenant_id: None,
            model_id: None,
            from: None,
            to: None,
            page: None,
            size: None,
        },
    )
    .await
    .expect("列举用量失败");
    assert_eq!(usage_total, 2, "平台面应看到两个租户的用量");
    let tenants: Vec<Option<String>> = usage.iter().map(|u| u.tenant_id.clone()).collect();
    for tenant in [fixture.tenant_a, fixture.tenant_b] {
        assert!(
            tenants.contains(&Some(tenant.to_string())),
            "用量汇总缺租户 {tenant}"
        );
    }

    let (audit, audit_total) = GatewayService::list_audit(&scope, AuditFilter::default(), 1, 50)
        .await
        .expect("列举审计失败");
    assert_eq!(audit_total, 2, "平台面应看到两个租户的审计");
    assert_eq!(audit.len(), 2);

    // 按租户过滤是查询条件，不是可见性
    let only_a = AuditFilter {
        tenant_id: Some(fixture.tenant_a),
        ..Default::default()
    };
    let (only_a, only_a_total) = GatewayService::list_audit(&scope, only_a, 1, 50)
        .await
        .expect("按租户过滤审计失败");
    assert_eq!(only_a_total, 1);
    assert_eq!(
        only_a[0].tenant_id.as_deref(),
        Some(fixture.tenant_a.to_string().as_str())
    );

    scope.rollback().await.expect("平台只读作用域回滚失败");
}

/// 平台面写入：新建的是全局行；改/删**租户行**必须报 404，而不是「一行没动却返回成功」。
#[tokio::test]
async fn platform_writes_touch_global_rows_only() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("进入平台特权作用域失败");
    let actor = fixture.owner_a.as_uuid();

    let provider = GatewayService::create_provider(
        &scope,
        &fixture.config,
        actor,
        provider_write("gw-created"),
    )
    .await
    .expect("新建平台供应商失败");
    assert!(!provider.has_api_key, "未给密钥时不应标成「已配置」");

    let model = GatewayService::create_model(
        &scope,
        actor,
        model_write(
            Uuid::parse_str(&provider.id).expect("供应商 ID 不是 UUID"),
            "gw-created-model",
        ),
    )
    .await
    .expect("新建平台模型失败");
    assert_eq!(model.provider_name.as_deref(), Some("gw-created"));

    // 租户行不在平台面的管辖范围内：既不能改也不能删
    assert!(
        matches!(
            GatewayService::update_provider(
                &scope,
                &fixture.config,
                actor,
                fixture.provider_a,
                provider_update(),
            )
            .await,
            Err(GatewayError::ProviderNotFound)
        ),
        "改租户供应商必须报 404"
    );
    assert!(
        matches!(
            GatewayService::delete_provider(&scope, fixture.provider_a).await,
            Err(GatewayError::ProviderNotFound)
        ),
        "删租户供应商必须报 404"
    );
    assert!(
        matches!(
            GatewayService::delete_model(&scope, fixture.model_a).await,
            Err(GatewayError::ModelNotFound(_))
        ),
        "删租户模型必须报 404"
    );

    scope.commit().await.expect("平台写入作用域提交失败");

    // 全局行落库、租户行原样保留（用超级用户口径核对）
    assert_eq!(
        count(
            &fixture.admin,
            "SELECT count(*) FROM gateway_provider WHERE \"tenantID\" IS NULL"
        )
        .await,
        2,
        "平台面应新增一条全局供应商"
    );
    assert_eq!(
        count(
            &fixture.admin,
            &format!(
                "SELECT count(*) FROM gateway_provider WHERE id = '{}'",
                fixture.provider_a
            )
        )
        .await,
        1,
        "租户私有供应商不得被平台面删掉"
    );
    assert_eq!(
        count(
            &fixture.admin,
            &format!(
                "SELECT count(*) FROM gateway_model WHERE id = '{}'",
                fixture.model_a
            )
        )
        .await,
        1,
        "租户私有模型不得被平台面删掉"
    );
}

/// 租户面：看到本租户私有行 + 全局行；别的租户的私有行读不到（策略兜底，不靠查询条件）。
#[tokio::test]
async fn tenant_scope_sees_own_and_global_rows_only() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let ctx = enter_tenant(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let names = model_names(
        &GatewayService::list_models(ctx.tx(), ctx.principal())
            .await
            .expect("列举可见模型失败"),
    );

    assert!(
        names.iter().any(|n| n.starts_with("global-")),
        "全局模型对租户面可见：{names:?}"
    );
    assert!(
        names.iter().any(|n| n.ends_with("-a")),
        "本租户私有模型应可见：{names:?}"
    );
    assert!(
        !names.iter().any(|n| n.ends_with("-b")),
        "别的租户的私有模型不得可见：{names:?}"
    );

    // 用平台面新增一条全局模型后，租户面立刻看得到——全局行本来就该共享
    ctx.rollback().await.expect("租户只读作用域回滚失败");

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("进入平台特权作用域失败");
    GatewayService::create_model(
        &scope,
        fixture.owner_a.as_uuid(),
        model_write(fixture.provider_global, "global-shared"),
    )
    .await
    .expect("新建全局模型失败");
    scope.commit().await.expect("平台写入作用域提交失败");

    let ctx = enter_tenant(&fixture, fixture.owner_b, fixture.tenant_b).await;
    let names = model_names(
        &GatewayService::list_models(ctx.tx(), ctx.principal())
            .await
            .expect("列举可见模型失败"),
    );
    assert!(
        names.iter().any(|n| n == "global-shared"),
        "新增的全局模型应对每个租户可见：{names:?}"
    );
    ctx.rollback().await.expect("租户只读作用域回滚失败");
}

/// 租户面审计：只读得到本租户的行，且必须是具备 `audit_event:read` 的角色。
#[tokio::test]
async fn tenant_audit_reads_own_rows_and_requires_audit_permission() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 种子里的两人都是 OWNER，读不了审计的对照物只能另加一名普通成员
    let member = UserId::generate();
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
               VALUES ('{member}', 'gw-member-{suffix}', '!', 'USER', 'ACTIVE', now(), now())"#
        ),
    )
    .await;
    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
               VALUES ('{}', '{}', '{member}', 'MEMBER', 'ACTIVE', now(), now())"#,
            Uuid::new_v4(),
            fixture.tenant_a
        ),
    )
    .await;

    // 1) A 租户的 OWNER 只看到 A 的行：可见性归作用域，不靠调用方拼条件
    let ctx = enter_tenant(&fixture, fixture.owner_a, fixture.tenant_a).await;
    let (rows, total) = GatewayService::list_audit_in_tenant(&ctx, AuditFilter::default(), 1, 50)
        .await
        .expect("租户面列举审计失败");
    assert_eq!(total, 1, "只应有 A 租户的种子行");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].tenant_id, Some(fixture.tenant_a.to_string()));

    let export = GatewayService::export_audit_in_tenant(&ctx, AuditFilter::default())
        .await
        .expect("租户面导出审计失败");
    assert_eq!(export.rows.len(), 1, "导出与列举必须同源");
    assert_eq!(export.rows[0].tenant_id, Some(fixture.tenant_a.to_string()));
    ctx.rollback().await.expect("租户只读作用域回滚失败");

    // 2) B 租户看自己那一行，A 的行连条件都拼不出来
    let ctx = enter_tenant(&fixture, fixture.owner_b, fixture.tenant_b).await;
    let (rows, total) = GatewayService::list_audit_in_tenant(&ctx, AuditFilter::default(), 1, 50)
        .await
        .expect("租户面列举审计失败");
    assert_eq!(total, 1);
    assert_eq!(rows[0].tenant_id, Some(fixture.tenant_b.to_string()));
    ctx.rollback().await.expect("租户只读作用域回滚失败");

    // 3) 跨租户条件在进作用域之前就该被拒（400），而不是「查出来是空的」
    let cross = AuditFilter::parse_for_tenant(
        TenantId::from_uuid(fixture.tenant_a),
        Some(&fixture.tenant_b.to_string()),
        None,
        None,
        None,
        None,
    )
    .expect_err("跨租户 tenantID 必须拒绝");
    assert!(
        matches!(cross, GatewayError::BadParam(_)),
        "跨租户 tenantID 应报参数错误，实际：{cross:?}"
    );

    // 4) 普通成员没有 `audit_event:read`：读与导出同一处判定，都必须 403
    let ctx = enter_tenant(&fixture, member, fixture.tenant_a).await;
    let denied = GatewayService::list_audit_in_tenant(&ctx, AuditFilter::default(), 1, 50)
        .await
        .expect_err("成员不得读审计");
    assert!(
        matches!(denied, GatewayError::Forbidden),
        "成员读审计应被拒，实际：{denied:?}"
    );
    let denied = match GatewayService::export_audit_in_tenant(&ctx, AuditFilter::default()).await {
        Ok(_) => panic!("成员不得导出审计"),
        Err(err) => err,
    };
    assert!(
        matches!(denied, GatewayError::Forbidden),
        "成员导出审计应被拒，实际：{denied:?}"
    );
    ctx.rollback().await.expect("租户只读作用域回滚失败");
}

/// 账号面：没有租户时只看得到全局行，连自己加入的租户的私有行也看不到。
#[tokio::test]
async fn account_scope_sees_global_rows_only() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let session = session_of(&fixture, fixture.owner_a).await;
    let scope = AccountScope::enter(&fixture.storage, &session)
        .await
        .expect("进入账号作用域失败");
    let principal = session.principal();
    assert!(
        principal.tenant_id().is_none(),
        "账号作用域不应带租户上下文"
    );

    let names = model_names(
        &GatewayService::list_models(scope.tx(), &principal)
            .await
            .expect("列举可见模型失败"),
    );
    assert!(names.iter().any(|n| n.starts_with("global-")), "{names:?}");
    assert!(
        !names.iter().any(|n| n.ends_with("-a")),
        "账号面看不到租户私有模型（那是租户作用域的事）：{names:?}"
    );
    assert!(!names.iter().any(|n| n.ends_with("-b")), "{names:?}");

    // 平台管理员不选租户时同样是账号面：租户私有行依旧不可见
    let admin_principal = Principal::new(fixture.owner_a, PlatformRole::Admin);
    let names = model_names(
        &GatewayService::list_models(scope.tx(), &admin_principal)
            .await
            .expect("列举可见模型失败"),
    );
    assert!(!names.iter().any(|n| n.ends_with("-a")), "{names:?}");

    scope.rollback().await.expect("账号只读作用域回滚失败");
}

/// 落库（用量/审计）跟着作用域走：越租户写入被策略拒绝，不再需要调用方自己拼 `tenantID`。
#[tokio::test]
async fn usage_writes_follow_the_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 租户面：落本租户的行可以
    let scope = TenantScope::open(&fixture.storage, TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("打开租户作用域失败");
    record_usage(
        scope.tx(),
        &usage_input(Some(fixture.tenant_a), fixture.owner_a, &fixture),
    )
    .await
    .expect("租户作用域内落本租户用量失败");
    record_audit(
        scope.tx(),
        Some(fixture.tenant_a),
        fixture.owner_a.as_uuid(),
        "gateway.invoke",
        "model",
        None,
        None,
    )
    .await
    .expect("租户作用域内落本租户审计失败");
    scope.commit().await.expect("租户写入作用域提交失败");

    // 租户面：落**别的**租户的行不行
    let scope = TenantScope::open(&fixture.storage, TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("打开租户作用域失败");
    let denied = record_usage(
        scope.tx(),
        &usage_input(Some(fixture.tenant_b), fixture.owner_b, &fixture),
    )
    .await
    .expect_err("租户作用域内落别的租户用量本应被策略拒绝");
    assert!(
        is_row_security_violation(&denied),
        "越租户写入应以行级策略拒绝（42501），实际：{denied}"
    );
    scope.rollback().await.expect("租户写入作用域回滚失败");

    // 账号面：只有「本人 + 无租户」的行写得进
    let session = session_of(&fixture, fixture.owner_a).await;
    let scope = AccountScope::enter(&fixture.storage, &session)
        .await
        .expect("进入账号作用域失败");
    record_usage(scope.tx(), &usage_input(None, fixture.owner_a, &fixture))
        .await
        .expect("账号作用域内落本人无租户用量失败");
    scope.commit().await.expect("账号写入作用域提交失败");

    let session = session_of(&fixture, fixture.owner_a).await;
    let scope = AccountScope::enter(&fixture.storage, &session)
        .await
        .expect("进入账号作用域失败");
    let denied = record_usage(
        scope.tx(),
        &usage_input(Some(fixture.tenant_a), fixture.owner_a, &fixture),
    )
    .await
    .expect_err("账号作用域内写租户行本应被策略拒绝");
    assert!(
        is_row_security_violation(&denied),
        "账号面写租户行应以行级策略拒绝（42501），实际：{denied}"
    );
    scope.rollback().await.expect("账号写入作用域回滚失败");

    // 超级用户口径核对：只有两次合法写入落库
    assert_eq!(
        count(&fixture.admin, "SELECT count(*) FROM gateway_usage").await,
        4,
        "两个租户各一行种子 + 两次合法写入"
    );
    assert_eq!(
        count(&fixture.admin, "SELECT count(*) FROM gateway_audit").await,
        3,
        "两个租户各一行种子 + 一次合法审计"
    );
}

/// 审计导出：过滤条件真的落到 SQL 上、缺省窗口真的补齐、渲染出来就是文件字节。
#[tokio::test]
async fn audit_export_applies_filters_and_fills_the_window() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    // 一条 40 天前的记录：缺省窗口是「最近 30 天」，它是这条规则的对照物
    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO gateway_audit (id, "tenantID", actor, action, resource, "createdAt")
               VALUES ('{}', '{}', '{}', 'gateway.export', 'model', now() - interval '40 days')"#,
            Uuid::new_v4(),
            fixture.tenant_a,
            fixture.owner_a
        ),
    )
    .await;

    let scope = PlatformScope::open(&fixture.storage)
        .await
        .expect("进入平台特权作用域失败");

    // 1) 不带任何条件：窗口两端被补齐，且把 40 天前那条挡住
    let export = GatewayService::export_audit(&scope, AuditFilter::default())
        .await
        .expect("审计导出失败");
    assert_eq!(export.rows.len(), 2, "缺省窗口只覆盖最近 30 天");
    assert!(!export.truncated, "两行远不到硬上限");
    assert!(
        export.from > 0 && export.from < export.to,
        "缺省窗口两端都该被补齐：{}..{}",
        export.from,
        export.to
    );

    // 2) 放宽窗口 + 按 action 收窄：只剩那条旧记录
    let now = Utc::now();
    let wide = AuditFilter::parse(
        None,
        None,
        Some("gateway.export"),
        Some((now - ChronoDuration::days(60)).timestamp_millis()),
        Some(now.timestamp_millis()),
    )
    .expect("过滤条件解析失败");
    let export = GatewayService::export_audit(&scope, wide)
        .await
        .expect("导出失败");
    assert_eq!(export.rows.len(), 1, "action 过滤没有生效");
    assert_eq!(export.rows[0].action, "gateway.export");

    // 3) 按 actor 收窄：owner_a 名下两行（本租户种子行 + 那条旧记录），owner_b 的行被挡掉
    let by_actor = AuditFilter::parse(
        None,
        Some(&fixture.owner_a.to_string()),
        None,
        Some((now - ChronoDuration::days(60)).timestamp_millis()),
        Some(now.timestamp_millis()),
    )
    .expect("过滤条件解析失败");
    let export = GatewayService::export_audit(&scope, by_actor)
        .await
        .expect("导出失败");
    assert_eq!(export.rows.len(), 2, "actor 过滤没有生效");
    assert!(
        export
            .rows
            .iter()
            .all(|row| row.actor == fixture.owner_a.to_string()),
        "导出里混进了别人名下的行"
    );

    // 4) 渲染出来的是文件字节：CSV 以 BOM + 表头开头，内容里能看到动作码
    let csv = String::from_utf8(render::render(AuditExportFormat::Csv, &export.rows))
        .expect("渲染结果必须是合法 UTF-8");
    assert!(
        csv.starts_with("\u{feff}id,tenantID,actor,action,resource,ip,createdAt,detail\r\n"),
        "CSV 必须带 BOM 且列序即契约，实际开头：{:?}",
        csv.chars().take(60).collect::<String>()
    );
    assert!(csv.contains("gateway.invoke"));

    // 文件名带上实际生效的窗口，消费方不必回看响应头
    let name = render::filename(export.from, export.to, AuditExportFormat::Csv);
    assert_eq!(
        name,
        format!(
            "audit-{}-{}.csv",
            stamp_of(export.from),
            stamp_of(export.to)
        )
    );
    assert!(name.is_ascii());

    scope.rollback().await.expect("平台只读作用域回滚失败");
}

/// 与 `render::filename` 内部同一格式，用来独立复核窗口被写进了文件名。
fn stamp_of(millis: i64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(millis)
        .expect("导出的窗口必须落在可表示范围内")
        .format("%Y%m%dT%H%M%SZ")
        .to_string()
}
