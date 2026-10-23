//! 服务端 agent 任务的端到端（P9c）：真 HTTP 链路 → 真库 RLS → 真 Redis → 真 JWT →
//! 进程内 durable 运行时 → compute（桩）。
//!
//! 这是仓库里第一条把「用户面鉴权 + 租户作用域 + RLS + durable 编排 + 出站契约 + 台账」
//! 串在一条链路上的用例。它守的是四件事：
//!
//! 1. 越权与坏入参在**建行之前**就被挡下（一条脏台账都不许留）；
//! 2. 编排起不来时台账如实说「失败」，而不是留一条永远 `RUNNING` 的记录；
//! 3. 别的租户的任务与不存在一样，都回同一个 404（不泄露存在性）；
//! 4. 多轮「模型 → 工具 → 模型」真的跑起来，进度对得上，出站报文形状与幂等键可复现。
//!
//! 需要 `TEST_DATABASE_URL`（`Migrator::fresh` 会**重建整个库**）与 `TEST_REDIS_URL`，
//! 且必须串行跑（`--test-threads=1`）——两条都缺就直接跳过。

mod support;

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use actix_web::test;
use durable::{Runtime, RuntimeTuning, Store};
use identity::PlatformRole;
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, Statement,
};
use serde_json::{Value, json};
use cogito::bootstrap::BootstrapOptions;
use cogito::clients::compute::{
    AgentMessage, AgentStepResponse, AgentToolCall, AgentToolResult, AgentUsage, ComputeClient,
    INTERNAL_SCHEMA_VERSION,
};
use cogito::clients::redis::RedisPool;
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::middlewares::rate_limit::AuthGovernor;
use cogito::oas::paths;
use cogito::orchestrations;
use cogito::utils::code::{self, auth, business, request as request_codes};
use cogito::utils::jwt::generate_token;
use support::{
    Script, StubCompute, bypass_proxy_for_local_stubs, settings, test_database_url, test_schema,
    wait_for_custom_status,
};
use tokio::sync::Mutex;
use uuid::Uuid;

/// 应用角色：`Migrator::fresh` 用超级用户建表，业务连接必须换成一个**非超级用户**，
/// 否则 `FORCE ROW LEVEL SECURITY` 会被静默绕过，跨租户的断言全部变成假绿。
const APP_ROLE: &str = "cogito_app_test";
const INTERNAL_TOKEN: &str = "test-internal-token";
const OBJECTIVE: &str = "把本租户的产品手册总结成一段话";
const ANSWER: &str = "手册讲了三件事：安装、配置、排障。";
const CHAT_MODEL: &str = "agent-test-model";
const EMBED_MODEL: &str = "test-embedding-model";
const TOOL_KNOWLEDGE: &str = "knowledge_search";
const TOOL_ASSET: &str = "asset_read";
/// 部署级轮次上限。压到 3 才能在几步之内同时覆盖「预算用尽」与「越界」。
const MAX_STEPS: usize = 3;
/// `cogito::services::agent::service` 里的目标长度上限（私有常量，此处照抄值以免用例引用实现细节）。
const MAX_OBJECTIVE_CHARS: usize = 4000;

/// `Migrator::fresh` 会重建整个库，用例之间只能串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

// ---------------------------------------------------------------------------
// 建 app
// ---------------------------------------------------------------------------

/// 宏而不是函数：`test::init_service` 的返回类型带着 `App` 的具体泛型，放进函数签名会写不出来；
/// 留在这里由调用点推断。
macro_rules! build_app {
    ($fixture:expr, $durable:expr $(,)?) => {{
        let storage = Arc::clone(&$fixture.storage);
        let config = Arc::clone(&$fixture.config);
        let redis = Arc::clone(&$fixture.redis);
        let durable: Option<Arc<durable::Client>> = $durable;
        let compute: Option<Arc<cogito::clients::compute::ComputeClient>> = None;

        test::init_service(cogito::bootstrap_app!(
            storage,
            Arc::clone(&config),
            redis,
            durable,
            compute,
            BootstrapOptions::development(false),
            AuthGovernor(None)
        ))
        .await
    }};
}

/// 发一次请求并把响应读成 `(状态码, JSON)`。
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

/// 轮询 `GET /agent/tasks/{id}` 直到台账落到终态。
///
/// 终态由「编排跑完」和「等待者结算」两步共同决定，没有确定的时刻可以等，只能轮询。
macro_rules! wait_for_terminal {
    ($app:expr, $token:expr, $tenant:expr, $id:expr) => {
        async {
            let deadline = Instant::now() + Duration::from_secs(60);
            loop {
                let (status, body) = call!($app, get_task($token, $tenant, &$id)).await;
                assert_eq!(status, 200, "查询任务失败：{body}");
                assert!(
                    body["success"].as_bool().unwrap_or(false),
                    "查询任务失败：{body}"
                );

                let data = body["data"].clone();
                if data["status"].as_str() != Some("RUNNING") {
                    break data;
                }
                assert!(Instant::now() < deadline, "等任务落到终态超时：{data}");

                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    };
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

struct Fixture {
    admin: DatabaseConnection,
    storage: Arc<Storage>,
    redis: Arc<RedisPool>,
    config: Arc<Configure>,
    /// 我们的租户：`user` 是它的成员。
    tenant: Uuid,
    /// 另一个租户：`user` 不在里面，它有自己的成员令牌。
    stranger: Uuid,
    user: Uuid,
    /// `user` 的 JWT（用 app 自己那份默认密钥签发，所以链路上验签是真的）。
    token: String,
    /// `stranger` 成员的 JWT：拿它配我们的租户头，必须 403。
    outsider_token: String,
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

/// 应用连接的连接串：把凭据换成那个非超级用户。
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
    // 出站桩都在 127.0.0.1，代理必须先绕开——任何 HTTP 客户端构造之前。
    bypass_proxy_for_local_stubs();

    let admin = connect(&uri, 2).await;
    migration::Migrator::fresh(&admin)
        .await
        .expect("重建测试库失败");

    // 非超级用户 + `NOBYPASSRLS`：RLS 才是真的在拦人。角色是库级对象，`fresh` 不会清掉它。
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
    // 授权按对象生效，重建库之后会丢，所以必须放在 `fresh` 之后。
    for grant in [
        "GRANT USAGE ON SCHEMA public",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public",
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public",
    ] {
        exec(&admin, &format!("{grant} TO {APP_ROLE}")).await;
    }
    exec(&admin, &format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}")).await;

    let mut config = Configure::default();
    config.agent.chat_model = CHAT_MODEL.to_owned();
    config.agent.max_steps = MAX_STEPS;
    config.agent.allowed_tools = vec![TOOL_KNOWLEDGE.to_owned(), TOOL_ASSET.to_owned()];
    config.compute.token = INTERNAL_TOKEN.to_owned();
    config.compute.embed_model = EMBED_MODEL.to_owned();

    let secret = config.security.jwt_secret.clone();

    let tenant = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let user = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let suffix = &Uuid::new_v4().simple().to_string()[..8];

    for (id, tag) in [
        (tenant, format!("agent-{suffix}-a")),
        (stranger, format!("agent-{suffix}-b")),
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

    // `role` 只能 ADMIN / USER；`auth` 表没有 RLS，所以这两个账号对应用连接也可读。
    for (id, tag, role) in [
        (user, format!("agent-{suffix}-u"), "USER"),
        (outsider, format!("agent-{suffix}-o"), "USER"),
    ] {
        exec(
            &admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{id}', '{tag}', '!', '{role}', 'ACTIVE', now(), now())"#
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
        token: generate_token(
            &user.to_string(),
            "agent-ctx-user",
            PlatformRole::User,
            &secret,
            None,
        )
        .expect("签发令牌失败"),
        outsider_token: generate_token(
            &outsider.to_string(),
            "agent-ctx-outsider",
            PlatformRole::User,
            &secret,
            None,
        )
        .expect("签发令牌失败"),
        admin,
        tenant,
        stranger,
        user,
    })
}

// ---------------------------------------------------------------------------
// 请求构造与断言辅助
// ---------------------------------------------------------------------------

fn post_task(token: Option<&str>, tenant: Option<&str>, payload: &Value) -> test::TestRequest {
    let mut request = test::TestRequest::post().uri(paths::AGENT_TASKS);

    if let Some(token) = token {
        request = request.insert_header(("Authorization", format!("Bearer {token}")));
    }
    if let Some(tenant) = tenant {
        request = request.insert_header(("X-Tenant-ID", tenant.to_owned()));
    }

    request.set_json(payload)
}

fn get_task(token: &str, tenant: &str, id: &str) -> test::TestRequest {
    test::TestRequest::get()
        .uri(&paths::AGENT_TASK_BY_ID.replace("{id}", id))
        .insert_header(("Authorization", format!("Bearer {token}")))
        .insert_header(("X-Tenant-ID", tenant.to_owned()))
}

fn error_code(body: &Value) -> i32 {
    body["code"]
        .as_i64()
        .unwrap_or_else(|| panic!("响应缺少数字 code：{body}")) as i32
}

/// 断言失败响应的状态码与错误码，返回 `msg` 供调用点继续核对文案。
fn assert_failure(body: &Value, status: u16, want_status: u16, want_code: i32) -> String {
    assert_eq!(status, want_status, "HTTP 状态不符：{body}");
    assert_eq!(
        body["success"],
        json!(false),
        "失败响应必须 success=false：{body}"
    );
    assert_eq!(error_code(body), want_code, "错误码不符：{body}");

    body["msg"]
        .as_str()
        .unwrap_or_else(|| panic!("失败响应缺少 msg：{body}"))
        .to_owned()
}

/// 断言成功响应的信封与业务码。
fn assert_success(body: &Value, status: u16) -> &Value {
    assert_eq!(status, 200, "HTTP 状态不符：{body}");
    assert_eq!(
        body["success"],
        json!(true),
        "响应必须 success=true：{body}"
    );
    assert_eq!(error_code(body), code::SUCCESS, "业务码不符：{body}");

    &body["data"]
}

/// 造一条单步响应：`call_id` 为空即终答。
///
/// 直接构造 DTO 而不是拼 JSON：字段名一旦漂移，这里跟着编译不过，比联调时才发现要早得多。
fn step(call_id: &str, tool: &str) -> AgentStepResponse {
    let usage = AgentUsage {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
    };

    if call_id.is_empty() {
        return AgentStepResponse {
            schema_version: INTERNAL_SCHEMA_VERSION,
            finished: true,
            message: AgentMessage {
                role: "assistant".to_owned(),
                content: Some(ANSWER.to_owned()),
                tool_calls: None,
                tool_call_id: None,
            },
            tool_results: Vec::new(),
            usage,
        };
    }

    AgentStepResponse {
        schema_version: INTERNAL_SCHEMA_VERSION,
        finished: false,
        message: AgentMessage {
            role: "assistant".to_owned(),
            content: Some("先查知识库".to_owned()),
            tool_calls: Some(vec![AgentToolCall {
                id: call_id.to_owned(),
                name: tool.to_owned(),
                arguments: Some("{}".to_owned()),
                tool_call_type: Some("function".to_owned()),
            }]),
            tool_call_id: None,
        },
        tool_results: vec![AgentToolResult {
            tool_call_id: call_id.to_owned(),
            name: tool.to_owned(),
            ok: true,
            content: format!("{call_id} 的结果"),
            error: None,
            awaiting_approval: None,
        }],
        usage,
    }
}

fn step_json(response: &AgentStepResponse) -> Value {
    serde_json::to_value(response).expect("单步响应必须可序列化")
}

// ---------------------------------------------------------------------------
// 用例 1：坏入参与越权在建行之前挡下
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn rejects_malformed_requests_without_touching_the_ledger() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    // durable 故意不接通：这一用例只验「还没走到起编排那一步」。
    let app = build_app!(fixture, None);

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());
    let valid = json!({ "objective": OBJECTIVE, "maxSteps": 2 });

    // 无令牌：鉴权发生在任何业务判断之前（连租户头都不看）。
    let (status, body) = call!(app, post_task(None, Some(tenant), &valid)).await;
    assert_failure(&body, status, 401, auth::NOT_LOGGED_IN);

    // 缺租户头：能证明身份，但作用域定不下来。
    let (status, body) = call!(app, post_task(Some(token), None, &valid)).await;
    assert_failure(&body, status, 400, request_codes::MISSING_PARAMETER);

    // 租户头不是 UUID：格式错误与「缺少」必须分开报，否则前端没法区分要补哪一个。
    let (status, body) = call!(app, post_task(Some(token), Some("not-a-uuid"), &valid)).await;
    assert_failure(&body, status, 400, request_codes::INVALID_HEADER);

    // 别的租户的成员拿我们的租户头：403，而不是 404。
    let (status, body) = call!(
        app,
        post_task(Some(fixture.outsider_token.as_str()), Some(tenant), &valid)
    )
    .await;
    assert_failure(&body, status, 403, auth::ACCESS_DENIED);

    // 目标为空（含纯空白）。
    let (status, body) = call!(
        app,
        post_task(Some(token), Some(tenant), &json!({ "objective": "   " })),
    )
    .await;
    let msg = assert_failure(&body, status, 422, business::agent::OBJECTIVE_INVALID);
    assert_eq!(msg, "任务目标不能为空");

    // 目标超长：边界值两侧都要卡住，否则「4000 个字符」这条承诺是假的。
    let long = "目".repeat(MAX_OBJECTIVE_CHARS + 1);
    let (status, body) = call!(
        app,
        post_task(Some(token), Some(tenant), &json!({ "objective": long })),
    )
    .await;
    let msg = assert_failure(&body, status, 422, business::agent::OBJECTIVE_INVALID);
    assert_eq!(msg, "任务目标不能超过 4000 个字符");

    // 轮次上限：0 与超出部署上限都拒。
    for steps in [0, MAX_STEPS + 1] {
        let (status, body) = call!(
            app,
            post_task(
                Some(token),
                Some(tenant),
                &json!({ "objective": OBJECTIVE, "maxSteps": steps })
            ),
        )
        .await;
        let msg = assert_failure(&body, status, 422, business::agent::MAX_STEPS_INVALID);
        assert_eq!(msg, format!("轮次上限须在 1..={MAX_STEPS} 之间"));
    }

    // 白名单外的工具：报错要把可用清单一起给出来，不然调用方只能猜。
    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "tools": ["nope"] }),
        ),
    )
    .await;
    let msg = assert_failure(&body, status, 422, business::agent::TOOL_NOT_ALLOWED);
    assert!(msg.contains("不在允许列表内"), "报错没点出工具名：{msg}");
    let list = format!("可用：{TOOL_KNOWLEDGE}, {TOOL_ASSET}");
    assert!(msg.contains(&list), "报错没给可用清单（{list}）：{msg}");

    // 全部挡在建行之前——一条脏台账都不许留。
    assert_eq!(
        scalar(&fixture.admin, "SELECT count(*)::text FROM agent_task")
            .await
            .as_deref(),
        Some("0"),
        "校验失败的请求不该在台账里留下任何行"
    );
}

// ---------------------------------------------------------------------------
// 用例 2：编排起不来时，台账如实说失败
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn reports_orchestration_offline_and_settles_the_ledger() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture, None);

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": 2 }),
        ),
    )
    .await;
    let msg = assert_failure(
        &body,
        status,
        503,
        business::agent::ORCHESTRATION_UNAVAILABLE,
    );
    assert_eq!(msg, "编排服务暂时不可用，请稍后重试");

    // 「任务确实没跑」必须落在库里，不能只是一句响应——否则调用方隔一会儿回来会查到
    // 一条永远 RUNNING 的记录。
    let row = scalar(
        &fixture.admin,
        "SELECT status || '|' || coalesce(error, '') FROM agent_task",
    )
    .await
    .expect("POST 失败也必须留下台账行，才能如实记录「没跑」");
    assert_eq!(row, "FAILED|编排运行时未接通（durable 未配置或连接失败）");

    let id = scalar(&fixture.admin, "SELECT id::text FROM agent_task")
        .await
        .expect("台账行 id");
    let (status, body) = call!(app, get_task(token, tenant, &id)).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "FAILED");
    assert_eq!(data["steps"], 0);
    assert!(
        data["error"]
            .as_str()
            .is_some_and(|error| error.contains("编排运行时未接通")),
        "GET 也要如实回失败原因：{body}"
    );
}

// ---------------------------------------------------------------------------
// 用例 3：别人的任务与不存在的任务回同一个 404
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn hides_other_tenants_tasks_behind_the_same_not_found() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };

    let uri = test_database_url().expect("已确认设置");
    let store = Store::connect(&settings(&uri, &test_schema()))
        .await
        .expect("连接 durable schema 失败");
    // 刻意不起 Runtime：查状态只是读库，读路径不该依赖运行中的编排器。
    let app = build_app!(fixture, Some(Arc::new(store.client())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // 连 UUID 都不是，与「存在但不属于我」回同一个码。
    let (status, body) = call!(app, get_task(token, tenant, "not-a-uuid")).await;
    let msg = assert_failure(&body, status, 404, business::agent::TASK_NOT_FOUND);
    assert_eq!(msg, "任务不存在");

    // 乙租户的任务：RLS 让它对本租户根本不存在，回同一个 404（不泄露「存在性」）。
    let foreign = Uuid::new_v4();
    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO agent_task (id, "tenantID", "userID", status, objective, model,
                                       "maxSteps", "allowedTools", "instanceID",
                                       "createdAt", "updatedAt")
               VALUES ('{foreign}', '{}', '{}', 'RUNNING', '{OBJECTIVE}', '{CHAT_MODEL}',
                       2, '[]'::jsonb, 'agent-{foreign}', now(), now())"#,
            fixture.stranger, fixture.user
        ),
    )
    .await;
    let (status, body) = call!(app, get_task(token, tenant, &foreign.to_string())).await;
    let msg = assert_failure(&body, status, 404, business::agent::TASK_NOT_FOUND);
    assert_eq!(msg, "任务不存在");

    // 本租户的行，但编排实例不在：宽限期内保持原样（进程可能只是还没起实例）。
    let fresh = Uuid::new_v4();
    let stale = Uuid::new_v4();
    for (id, created) in [
        (fresh, "now()".to_owned()),
        (stale, "now() - interval '10 minutes'".to_owned()),
    ] {
        exec(
            &fixture.admin,
            &format!(
                r#"INSERT INTO agent_task (id, "tenantID", "userID", status, objective, model,
                                           "maxSteps", "allowedTools", "instanceID",
                                           "createdAt", "updatedAt")
                   VALUES ('{id}', '{tenant}', '{}', 'RUNNING', '{OBJECTIVE}', '{CHAT_MODEL}',
                           2, '[]'::jsonb, 'agent-{id}', {created}, now())"#,
                fixture.user
            ),
        )
        .await;
    }

    let (status, body) = call!(app, get_task(token, tenant, &fresh.to_string())).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "RUNNING", "宽限期内不该判死：{body}");
    assert_eq!(data["progress"], json!(null));

    let (status, body) = call!(app, get_task(token, tenant, &stale.to_string())).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "FAILED", "过了宽限期必须判死：{body}");
    assert_eq!(data["error"], "编排实例已不存在（任务记录仍在，未跑完）");
}

// ---------------------------------------------------------------------------
// 用例 4：真跑一条多轮任务，跨三跳同步观察进度（Gate）
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn runs_a_task_to_a_conclusion_and_reports_live_progress() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };

    let uri = test_database_url().expect("已确认设置");
    let store = Store::connect(&settings(&uri, &test_schema()))
        .await
        .expect("连接 durable schema 失败");
    let client = store.client();

    let stub = StubCompute::start(
        Script::agent(vec![
            step_json(&step("call-1", TOOL_KNOWLEDGE)),
            step_json(&step("call-2", TOOL_ASSET)),
            step_json(&step("call-3", TOOL_KNOWLEDGE)),
            // 第 4 条留给任务 B：终答。
            step_json(&step("", TOOL_KNOWLEDGE)),
        ])
        // 第 2 步按住：在下游一直不回包的状态下观察编排写出来的实时进度。
        .hang("/agents/steps", 2),
    )
    .await;

    let compute = ComputeClient::from_parts(&stub.base_url(), INTERNAL_TOKEN, 10_000, false)
        .expect("装配 compute 客户端失败");
    let registered = orchestrations::registrations(Arc::new(compute), 16, EMBED_MODEL.to_owned());
    let runtime = Runtime::start(
        &store,
        registered.activities,
        registered.orchestrations,
        RuntimeTuning::default(),
    )
    .await
    .expect("启动 durable 运行时失败");

    let app = build_app!(fixture, Some(Arc::new(client.clone())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // 1. 起任务（maxSteps = 上限 3，所以第 3 步会把工具清空并耗尽预算）
    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": MAX_STEPS }),
        ),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(body["msg"], "创建成功");
    assert_eq!(data["status"], "RUNNING");
    assert_eq!(data["steps"], 0);
    assert_eq!(data["progress"], json!(null));
    assert_eq!(data["finished"], json!(null));
    assert_eq!(data["result"], json!(null));
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["objective"], OBJECTIVE);
    assert_eq!(data["model"], CHAT_MODEL);
    assert_eq!(data["maxSteps"], json!(MAX_STEPS));
    assert_eq!(data["allowedTools"], json!([TOOL_KNOWLEDGE, TOOL_ASSET]));
    assert_eq!(
        data["userID"]
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok()),
        Some(fixture.user)
    );

    let task_a = data["id"].as_str().expect("任务 id").to_owned();
    let instance_a = format!("agent-{task_a}");
    // 任务 id 与实例 id 必须同源：幂等键、trace、续跑全靠实例 id 唯一。
    assert_eq!(
        scalar(
            &fixture.admin,
            &format!("SELECT \"instanceID\" FROM agent_task WHERE id = '{task_a}'")
        )
        .await
        .as_deref(),
        Some(instance_a.as_str())
    );

    // 2. 第 2 步按住不放，编排停在「已写进度、等活动回包」
    stub.wait_for("/agents/steps", 2, Duration::from_secs(30))
        .await;
    wait_for_custom_status(&client, &instance_a, "step:2/3 tools:2").await;

    // 3. 进度必须能**实时**读出来，且覆盖台账列（台账里 steps 还是 0）
    let (status, body) = call!(app, get_task(token, tenant, &task_a)).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "RUNNING");
    assert_eq!(data["progress"], "step:2/3 tools:2");
    assert_eq!(data["steps"], json!(2), "实时进度应当覆盖台账里的旧值");
    assert_eq!(
        scalar(
            &fixture.admin,
            &format!("SELECT steps::text FROM agent_task WHERE id = '{task_a}'")
        )
        .await
        .as_deref(),
        Some("0"),
        "台账列此时仍是旧值，进度来自编排的 custom status"
    );

    // 4. 出站报文形状：第一步不带历史（空数组被省略），第二步带着「助手 + 工具」两条
    let requests = stub.matching("/agents/steps");
    let first = &requests[0];
    assert_eq!(first.internal_token(), INTERNAL_TOKEN);
    assert!(
        first.path.ends_with("/internal/v1/agents/steps"),
        "{}",
        first.path
    );
    let payload = first.json();
    assert_eq!(payload["schemaVersion"], json!(INTERNAL_SCHEMA_VERSION));
    assert_eq!(payload["tenantID"], tenant);
    assert_eq!(payload["objective"], OBJECTIVE);
    assert_eq!(payload["model"], CHAT_MODEL);
    assert_eq!(payload["embedModel"], EMBED_MODEL);
    assert_eq!(payload["remainingSteps"], json!(MAX_STEPS));
    assert_eq!(payload["allowedTools"], json!([TOOL_KNOWLEDGE, TOOL_ASSET]));
    // 出站单步请求只带租户：终端用户身份留在 cogito 的台账里，模型侧不需要知道。
    assert!(
        payload.get("userID").is_none(),
        "单步请求不该带终端用户：{payload}"
    );
    assert!(
        payload.get("history").is_none(),
        "第一步不该带历史（空数组会被省略）：{payload}"
    );

    let second = requests[1].json();
    assert_eq!(second["remainingSteps"], json!(MAX_STEPS - 1));
    let history = second["history"]
        .as_array()
        .expect("第二步必须带上历史")
        .clone();
    assert_eq!(history.len(), 2);
    // 整对象比较：字段名一旦漂移（`toolCallID` / `toolCalls` / `toolCallType`）这里就红，
    // 而不是等到联调时才发现两边的线格式对不上。
    assert_eq!(
        history[0],
        json!({
            "role": "assistant",
            "content": "先查知识库",
            "toolCalls": [{
                "id": "call-1",
                "name": TOOL_KNOWLEDGE,
                "arguments": "{}",
                "toolCallType": "function",
            }],
        }),
        "助手消息的形状：{history:?}"
    );
    assert_eq!(
        history[1],
        json!({
            "role": "tool",
            "content": "call-1 的结果",
            "toolCallID": "call-1",
        })
    );

    // 5. 放行后第 3 步：预算只剩 1 轮，编排主动清空工具白名单
    stub.release("/agents/steps", 2);
    stub.wait_for("/agents/steps", 3, Duration::from_secs(30))
        .await;
    let third = stub.matching("/agents/steps")[2].json();
    assert_eq!(third["remainingSteps"], json!(1));
    assert_eq!(
        third["allowedTools"],
        json!([]),
        "最后一轮不该再给工具（给了就没机会用结论收尾）"
    );
    assert_eq!(
        third["history"].as_array().map(Vec::len),
        Some(4),
        "历史应当是「助手+工具」两两成对累积"
    );

    // 6. 预算耗尽：任务结束但不是「答完了」，这一点必须能在台账上区分出来
    let data = wait_for_terminal!(app, token, tenant, task_a).await;
    assert_eq!(data["status"], "SUCCEEDED");
    assert_eq!(data["steps"], json!(MAX_STEPS));
    assert_eq!(data["progress"], json!(null));
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["result"]["finished"], json!(false));
    assert_eq!(data["result"]["steps"], json!(MAX_STEPS));
    assert_eq!(data["result"]["toolCalls"], json!(3));
    assert_eq!(data["result"]["taskID"], task_a);
    // 预算耗尽与「答完了」都是 `SUCCEEDED`（编排本身没出错），唯一判据是 `finished`：
    // 这里的 `answer` 只是模型最后一段正文，不是结论。
    assert_eq!(data["result"]["answer"], "先查知识库");
    assert_eq!(
        data["result"]["memoryID"],
        json!(null),
        "轮次耗尽的半截结论不该进长期记忆：它会被之后的任务当成既有事实召回"
    );
    assert_eq!(
        stub.count("/agents/memories"),
        0,
        "任务没真正收尾，就不该有任何记忆写入"
    );

    // 7. 第二个任务：限定只用 asset_read，一步就给结论
    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": MAX_STEPS, "tools": [TOOL_ASSET] }),
        ),
    )
    .await;
    let task_b = assert_success(&body, status)["id"]
        .as_str()
        .expect("任务 id")
        .to_owned();
    let data = wait_for_terminal!(app, token, tenant, task_b).await;
    assert_eq!(data["status"], "SUCCEEDED");
    assert_eq!(data["steps"], json!(1));
    assert_eq!(data["allowedTools"], json!([TOOL_ASSET]));
    assert_eq!(data["result"]["finished"], json!(true));
    assert_eq!(data["result"]["toolCalls"], json!(0));
    assert_eq!(data["result"]["answer"], ANSWER);
    // 真正收尾的任务会把结论记进长期记忆，id 回到台账里（`memoryID` 是 uuid 字符串）。
    assert_eq!(
        data["result"]["memoryID"],
        json!(support::MEMORY_ID),
        "收尾的结论应当拿到一个记忆 id"
    );

    let requests = stub.matching("/agents/steps");
    let fourth = requests[3].json();
    assert_eq!(fourth["remainingSteps"], json!(MAX_STEPS));
    assert_eq!(fourth["allowedTools"], json!([TOOL_ASSET]));
    assert!(
        fourth.get("history").is_none(),
        "新任务的第一步不该带上个任务的历史：{fourth}"
    );

    // 8. 幂等键：实例 + 步号，重放同一步拿到的必须是同一个键
    assert_eq!(
        stub.idempotency_keys("/agents/steps"),
        vec![
            format!("{instance_a}:step:1"),
            format!("{instance_a}:step:2"),
            format!("{instance_a}:step:3"),
            format!("agent-{task_b}:step:1"),
        ]
    );

    // 8.1 收尾记忆的出站报文：只发过一条，且属于收尾的那个任务
    let memories = stub.matching("/agents/memories");
    assert_eq!(memories.len(), 1, "只有真正收尾的任务才写记忆");
    let memory = &memories[0];
    assert_eq!(memory.internal_token(), INTERNAL_TOKEN);
    assert!(
        memory.path.ends_with("/internal/v1/agents/memories"),
        "{}",
        memory.path
    );
    let payload = memory.json();
    assert_eq!(payload["schemaVersion"], json!(INTERNAL_SCHEMA_VERSION));
    assert_eq!(payload["tenantID"], tenant);
    assert_eq!(payload["taskID"], task_b, "记忆必须挂到收尾的那个任务上");
    assert_eq!(payload["objective"], OBJECTIVE);
    assert_eq!(payload["answer"], ANSWER);
    assert_eq!(payload["steps"], json!(1));
    assert_eq!(payload["toolCalls"], json!(0));
    assert_eq!(payload["embedModel"], EMBED_MODEL);
    assert_eq!(memory.idempotency_key(), format!("agent-{task_b}:remember"));
    // 记忆请求也走链路（不装 OTel 时按幂等键确定性地派生根链路）。
    assert_eq!(memory.traceparent().split('-').count(), 4);

    // 9. 链路：每一步都要带上一条格式合法的 traceparent，且各步互不相同。
    //    测试里没有装 OTel layer，所以这里走的是「按幂等键确定性派生」那条分支；
    //    只断言格式与相异性，不断言与上游共享 trace-id（那要求真的向上游续链）。
    let tracings = stub
        .matching("/agents/steps")
        .iter()
        .map(|request| request.traceparent())
        .collect::<Vec<_>>();
    assert_eq!(tracings.len(), 4);
    for traceparent in &tracings {
        let parts = traceparent.split('-').collect::<Vec<_>>();
        assert_eq!(parts.len(), 4, "traceparent 段数不对：{traceparent}");
        assert_eq!(parts[0], "00", "traceparent 版本不对：{traceparent}");
        assert_eq!(parts[1].len(), 32, "trace-id 长度不对：{traceparent}");
        assert_eq!(parts[2].len(), 16, "span-id 长度不对：{traceparent}");
        assert_eq!(parts[3], "01", "traceparent 采样位不对：{traceparent}");
        assert!(
            parts[1].chars().all(|c| c.is_ascii_hexdigit())
                && parts[2].chars().all(|c| c.is_ascii_hexdigit()),
            "traceparent 不是十六进制：{traceparent}"
        );
    }
    let unique = tracings.iter().collect::<std::collections::HashSet<_>>();
    assert_eq!(unique.len(), 4, "每一步都该是独立的一条链路：{tracings:?}");

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}

// ---------------------------------------------------------------------------
// 用例 5：记忆写不进去，任务结论照样成立
// ---------------------------------------------------------------------------

/// 长期记忆是**附加**产物：它的失败不能把已经得到的结论判成失败，也不能让编排重试到天亮。
///
/// 桩回 400 是刻意的——那是「请求本身有问题」这一类，编排必须**立刻放弃**（`is_retryable`
/// 为假），而不是按 1s / 2s / 4s / 8s 退避重试五轮。用 503 测这条会多花 15 秒，还会把
/// 「不可重试」和「重试后仍失败」两个不同的语义搅在一起。
#[actix_web::test]
async fn a_failed_memory_write_does_not_change_the_conclusion() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };

    let uri = test_database_url().expect("已确认设置");
    let store = Store::connect(&settings(&uri, &test_schema()))
        .await
        .expect("连接 durable schema 失败");
    let client = store.client();

    let stub = StubCompute::start(
        Script::agent(vec![step_json(&step("", TOOL_ASSET))]).status("memories", 400),
    )
    .await;

    let compute = ComputeClient::from_parts(&stub.base_url(), INTERNAL_TOKEN, 10_000, false)
        .expect("装配 compute 客户端失败");
    let registered = orchestrations::registrations(Arc::new(compute), 16, EMBED_MODEL.to_owned());
    let runtime = Runtime::start(
        &store,
        registered.activities,
        registered.orchestrations,
        RuntimeTuning::default(),
    )
    .await
    .expect("启动 durable 运行时失败");

    let app = build_app!(fixture, Some(Arc::new(client.clone())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": MAX_STEPS, "tools": [TOOL_ASSET] }),
        ),
    )
    .await;
    let task = assert_success(&body, status)["id"]
        .as_str()
        .expect("任务 id")
        .to_owned();

    let data = wait_for_terminal!(app, token, tenant, task).await;
    assert_eq!(data["status"], "SUCCEEDED", "记忆写失败不该改变任务结论");
    assert_eq!(data["steps"], json!(1));
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["result"]["finished"], json!(true));
    assert_eq!(data["result"]["answer"], ANSWER);
    assert_eq!(
        data["result"]["memoryID"],
        json!(null),
        "记忆没写成，结果里就不该有 id"
    );

    // 只发过一次：400 是不可重试分类，重试就成了「对着明确的拒绝反复敲门」。
    assert_eq!(
        stub.count("/agents/memories"),
        1,
        "不可重试的失败必须立刻放弃，而不是退避重试"
    );

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}
