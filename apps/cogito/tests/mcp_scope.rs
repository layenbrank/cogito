//! MCP 端点的用户面端到端：真 HTTP 链路 → 真库 RLS → 真 Redis → 真 JWT → ai-worker（桩）。
//!
//! 工具目录与名字映射的纯规则在 `crates/mcp`（单测），这里守的是它们**接上 HTTP 与
//! ai-worker 之后**还成不成立：
//!
//! 1. `initialize` / `tools/list` 的协议形状与目录顺序；
//! 2. 读工具 `tools/call` 真的转发到 ai-worker 的直通通道（桩能收到请求）；
//! 3. 写工具 `tools/call` **进目录但调用即拒绝**（不碰 ai-worker）；
//! 4. 不认识的方法 / 工具名按 JSON-RPC 错误码回（-32601 / -32602）；
//! 5. 通知（无 id）回 202；解析失败回 -32700；
//! 6. HTTP 层鉴权：未登录 401、非租户成员 403、缺租户头 400。
//!
//! 需要 `TEST_DATABASE_URL`（`Migrator::fresh` 会**重建整个库**）与 `TEST_REDIS_URL`，
//! 且必须串行跑（`--test-threads=1`）——两条都缺就直接跳过。

mod support;

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use actix_web::test;
use cogito::bootstrap::BootstrapOptions;
use cogito::clients::ai_worker::AiWorkerClient;
use cogito::clients::redis::RedisPool;
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::middlewares::rate_limit::AuthGovernor;
use cogito::oas::paths::MCP;
use cogito::utils::jwt::generate_token;
use identity::PlatformRole;
use migration::MigratorTrait;
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, Statement};
use serde_json::{Value, json};
use support::{Script, StubAiWorker, bypass_proxy_for_local_stubs, test_database_url};
use tokio::sync::Mutex;
use uuid::Uuid;

/// 应用角色：`Migrator::fresh` 用超级用户建表，业务连接必须换成一个**非超级用户**，
/// 否则 `FORCE ROW LEVEL SECURITY` 会被静默绕过，跨租户的断言全部变成假绿。
const APP_ROLE: &str = "cogito_app_test";
/// 桩用的内部令牌值：ai-worker 桩不校验它，cogito 只负责带上。
const INTERNAL_TOKEN: &str = "test-internal-token";

/// `Migrator::fresh` 会重建整个库，用例之间只能串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

struct Fixture {
    storage: Arc<Storage>,
    redis: Arc<RedisPool>,
    config: Arc<Configure>,
    /// 我们的租户：`token` 的主人是它的成员。
    tenant: Uuid,
    token: String,
    /// `stranger` 成员的 JWT：拿我们的租户头必须 403。
    outsider_token: String,
    /// ai-worker 桩（必须活到测试结束；MCP 读工具转发到这里）。
    stub: StubAiWorker,
}

async fn connect(uri: &str, max: u32) -> DatabaseConnection {
    let mut options = ConnectOptions::new(uri.to_owned());
    options
        .max_connections(max)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(10))
        .acquire_timeout(Duration::from_secs(30))
        .sqlx_logging(false);

    Database::connect(options).await.expect("连接测试库失败")
}

fn app_uri(uri: &str) -> String {
    let (scheme, rest) = uri.split_once("://").expect("TEST_DATABASE_URL 缺少协议");
    let (_, host_and_db) = rest.split_once('@').expect("TEST_DATABASE_URL 缺少 @");

    format!("{scheme}://{APP_ROLE}:{APP_ROLE}@{host_and_db}")
}

fn database_of(uri: &str) -> String {
    uri.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .expect("TEST_DATABASE_URL 缺少库名")
        .split('?')
        .next()
        .expect("库名")
        .to_owned()
}

fn test_redis_url() -> Option<String> {
    match std::env::var("TEST_REDIS_URL") {
        Ok(url) if !url.trim().is_empty() => Some(url),
        _ => {
            eprintln!("跳过：未设置 TEST_REDIS_URL");
            None
        }
    }
}

async fn exec<C: ConnectionTrait>(db: &C, sql: &str) {
    if let Err(error) = db.execute_unprepared(sql).await {
        panic!("SQL 执行失败：{sql}\n{error}");
    }
}

async fn scalar<C: ConnectionTrait>(db: &C, sql: &str) -> Option<String> {
    db.query_one_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|error| panic!("查询失败：{sql}\n{error}"))
    .map(|row| {
        row.try_get_by_index::<String>(0)
            .unwrap_or_else(|error| panic!("结果不是 text：{sql}\n{error}"))
    })
}

async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let redis_url = test_redis_url()?;
    bypass_proxy_for_local_stubs();

    let admin = connect(&uri, 2).await;
    migration::Migrator::fresh(&admin)
        .await
        .expect("重建测试库失败");

    let exists = scalar(
        &admin,
        &format!("SELECT count(*)::text FROM pg_roles WHERE rolname = '{APP_ROLE}'"),
    )
    .await;
    if exists.as_deref() != Some("1") {
        exec(
            &admin,
            &format!(
                "CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_ROLE}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
            ),
        )
        .await;
    }
    for grant in [
        "GRANT USAGE ON SCHEMA public",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public",
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public",
    ] {
        exec(&admin, &format!("{grant} TO {APP_ROLE}")).await;
    }
    exec(&admin, &format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}")).await;

    let config = Configure::default();
    let secret = config.security.jwt_secret.clone();

    let tenant = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let user = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let suffix = &Uuid::new_v4().simple().to_string()[..8];

    for (id, tag) in [
        (tenant, format!("mcp-{suffix}-a")),
        (stranger, format!("mcp-{suffix}-b")),
    ] {
        exec(
            &admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
                   VALUES ('{id}', '{tag}', '{tag}', 'ACTIVE', 'TEAM', now(), now())"#
            ),
        )
        .await;
    }

    for (id, tag) in [
        (user, format!("mcp-{suffix}-u")),
        (outsider, format!("mcp-{suffix}-o")),
    ] {
        exec(
            &admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{id}', '{tag}', '!', 'USER', 'ACTIVE', now(), now())"#
            ),
        )
        .await;
    }

    for (id, tenant_id, user_id) in [
        (Uuid::new_v4(), tenant, user),
        (Uuid::new_v4(), stranger, outsider),
    ] {
        exec(
            &admin,
            &format!(
                r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
                   VALUES ('{id}', '{tenant_id}', '{user_id}', 'OWNER', 'ACTIVE', now(), now())"#
            ),
        )
        .await;
    }

    let token = generate_token(&user.to_string(), "mcp-user", PlatformRole::User, &secret, None)
        .expect("签发令牌失败");
    let outsider_token = generate_token(
        &outsider.to_string(),
        "mcp-outsider",
        PlatformRole::User,
        &secret,
        None,
    )
    .expect("签发令牌失败");

    let stub = StubAiWorker::start(Script::new(0, 0)).await;

    Some(Fixture {
        storage: Arc::new(Storage::from_parts(
            connect(&app_uri(&uri), 5).await,
            database_of(&uri),
        )),
        redis: Arc::new(
            RedisPool::new(&redis_url, 4)
                .await
                .expect("连接测试 Redis 失败"),
        ),
        config: Arc::new(config),
        tenant,
        token,
        outsider_token,
        stub,
    })
}

// ---------------------------------------------------------------------------
// 请求构造与断言辅助
// ---------------------------------------------------------------------------

macro_rules! build_app {
    ($fixture:expr $(,)?) => {{
        let storage = Arc::clone(&$fixture.storage);
        let config = Arc::clone(&$fixture.config);
        let redis = Arc::clone(&$fixture.redis);
        let durable: Option<Arc<durable::Client>> = None;
        // MCP 读工具要转发 ai-worker：客户端指向本地桩（http 客户端直连，不走系统代理）。
        let ai_worker: Option<Arc<AiWorkerClient>> =
            AiWorkerClient::from_parts(&$fixture.stub.base_url(), INTERNAL_TOKEN, 5_000, false)
                .ok()
                .map(Arc::new);
        test::init_service(cogito::bootstrap_app!(
            storage,
            Arc::clone(&config),
            redis,
            durable,
            ai_worker,
            BootstrapOptions::development(false),
            AuthGovernor(None)
        ))
        .await
    }};
}

macro_rules! call {
    ($app:expr, $request:expr $(,)?) => {
        async {
            let response = test::call_service(&$app, $request.to_request()).await;
            let status = response.status().as_u16();
            let body = test::read_body(response).await;
            (
                status,
                serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null),
            )
        }
    };
}

/// 一条 JSON-RPC 请求体。
fn jsonrpc(method: &str, id: Option<i64>, params: Option<Value>) -> Value {
    let mut body = json!({ "jsonrpc": "2.0", "method": method });
    if let Some(id) = id {
        body["id"] = json!(id);
    }
    if let Some(params) = params {
        body["params"] = params;
    }
    body
}

fn mcp_request(token: Option<&str>, tenant: Option<&str>, payload: &Value) -> test::TestRequest {
    let mut request = test::TestRequest::post().uri(MCP);
    if let Some(token) = token {
        request = request.insert_header(("Authorization", format!("Bearer {token}")));
    }
    if let Some(tenant) = tenant {
        request = request.insert_header(("X-Tenant-ID", tenant.to_owned()));
    }
    request.set_json(payload)
}

fn tool_call_params(name: &str, arguments: Value) -> Value {
    json!({ "name": name, "arguments": arguments })
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn initialize_handshake_declares_protocol_and_server() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    let (status, body) = call!(
        app,
        mcp_request(Some(&fixture.token), Some(&fixture.tenant.to_string()), &jsonrpc("initialize", Some(1), None))
    )
    .await;

    assert_eq!(status, 200, "initialize 应回 200：{body}");
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], 1);
    assert_eq!(body["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(body["result"]["serverInfo"]["name"], "cogito");
    assert!(body["result"]["capabilities"]["tools"].is_object());
}

#[actix_web::test]
async fn tools_list_returns_the_five_tool_catalogue() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    let (status, body) = call!(
        app,
        mcp_request(Some(&fixture.token), Some(&fixture.tenant.to_string()), &jsonrpc("tools/list", Some(2), None))
    )
    .await;

    assert_eq!(status, 200, "tools/list 应回 200：{body}");
    let names: Vec<&str> = body["result"]["tools"]
        .as_array()
        .expect("tools 是数组")
        .iter()
        .map(|tool| tool["name"].as_str().expect("工具名"))
        .collect();
    assert_eq!(
        names,
        [
            "cogito_knowledge_search",
            "cogito_asset_read",
            "cogito_memory_recall",
            "cogito_memory_write",
            "cogito_asset_visibility_write",
        ]
    );
    // 写工具也进目录（方案 B：清单完整），inputSchema 都在。
    for tool in body["result"]["tools"].as_array().expect("数组") {
        assert!(tool["inputSchema"].is_object(), "工具缺 inputSchema：{tool}");
    }
}

#[actix_web::test]
async fn read_tool_call_forwards_to_ai_worker() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    let (status, body) = call!(
        app,
        mcp_request(
            Some(&fixture.token),
            Some(&fixture.tenant.to_string()),
            &jsonrpc("tools/call", Some(3), Some(tool_call_params("cogito_knowledge_search", json!({ "query": "退款政策" }))))
        )
    )
    .await;

    assert_eq!(status, 200, "读工具应回 200：{body}");
    let result = &body["result"];
    assert_eq!(result["isError"], false);
    let text = result["content"][0]["text"].as_str().expect("文本内容");
    assert!(text.contains("直通执行完成"), "读工具应转发到 ai-worker：{body}");

    // 桩确实收到了直通通道的一次调用，且载荷是剥掉前缀后的工具名。
    let requests = fixture.stub.matching("/tool-invocations");
    assert_eq!(requests.len(), 1, "桩应收到一次直通调用：{requests:#?}");
    let recorded = &requests[0];
    assert_eq!(recorded.json()["toolCall"]["name"], "knowledge_search");
    assert_eq!(recorded.json()["tenantID"], fixture.tenant.to_string());
}

#[actix_web::test]
async fn write_tool_call_is_rejected_without_touching_ai_worker() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    let (status, body) = call!(
        app,
        mcp_request(
            Some(&fixture.token),
            Some(&fixture.tenant.to_string()),
            &jsonrpc("tools/call", Some(4), Some(tool_call_params("cogito_memory_write", json!({ "content": "一条结论" }))))
        )
    )
    .await;

    assert_eq!(status, 200, "写工具拒绝也应是 200（isError）：{body}");
    let result = &body["result"];
    assert_eq!(result["isError"], true);
    let text = result["content"][0]["text"].as_str().expect("文本内容");
    assert!(text.contains("人工审批"), "拒绝文本要说明审批通道：{body}");
    // 拒绝发生在 cogito 侧，不碰 ai-worker。
    assert_eq!(fixture.stub.count("/tool-invocations"), 0);
}

#[actix_web::test]
async fn unknown_tool_and_method_return_jsonrpc_errors() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    // 不认识的工具名 → -32602（invalid params）。
    let (status, body) = call!(
        app,
        mcp_request(
            Some(&fixture.token),
            Some(&fixture.tenant.to_string()),
            &jsonrpc("tools/call", Some(5), Some(tool_call_params("cogito_nope", json!({}))))
        )
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["error"]["code"], -32602, "未知工具应报参数错：{body}");

    // 不认识的 JSON-RPC 方法 → -32601。
    let (status, body) = call!(
        app,
        mcp_request(Some(&fixture.token), Some(&fixture.tenant.to_string()), &jsonrpc("nope", Some(6), None))
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["error"]["code"], -32601, "未知方法应报方法不存在：{body}");
}

#[actix_web::test]
async fn notification_returns_accepted() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    let (status, _body) = call!(
        app,
        mcp_request(
            Some(&fixture.token),
            Some(&fixture.tenant.to_string()),
            &jsonrpc("notifications/initialized", None, None)
        )
    )
    .await;

    assert_eq!(status, 202, "通知应回 202 空体");
}

#[actix_web::test]
async fn http_auth_failures_stay_in_the_rest_envelope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    // 未登录 → 401。
    let (status, body) = call!(
        app,
        mcp_request(None, Some(&fixture.tenant.to_string()), &jsonrpc("ping", Some(7), None))
    )
    .await;
    assert_eq!(status, 401, "未登录应 401：{body}");
    assert_eq!(body["success"], false);

    // 非成员拿我们的租户头 → 403。
    let (status, body) = call!(
        app,
        mcp_request(
            Some(&fixture.outsider_token),
            Some(&fixture.tenant.to_string()),
            &jsonrpc("ping", Some(8), None)
        )
    )
    .await;
    assert_eq!(status, 403, "非租户成员应 403：{body}");
    assert_eq!(body["success"], false);

    // 缺租户头 → 400。
    let (status, body) = call!(
        app,
        mcp_request(Some(&fixture.token), None, &jsonrpc("ping", Some(9), None))
    )
    .await;
    assert_eq!(status, 400, "缺 X-Tenant-ID 应 400：{body}");
}

#[actix_web::test]
async fn parse_error_returns_a_jsonrpc_error_with_null_id() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);

    let request = test::TestRequest::post()
        .uri(MCP)
        .insert_header(("Authorization", format!("Bearer {}", fixture.token)))
        .insert_header(("X-Tenant-ID", fixture.tenant.to_string()))
        .set_payload(b"this is not json".as_slice())
        .to_request();
    let response = test::call_service(&app, request).await;
    let status = response.status().as_u16();
    let body: Value = test::read_body_json(response).await;

    assert_eq!(status, 200, "解析失败也是 JSON-RPC 错误（HTTP 200）：{body}");
    assert_eq!(body["error"]["code"], -32700);
    assert!(body["id"].is_null());
}
