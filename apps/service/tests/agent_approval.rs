//! 服务端 agent 写工具的**人工审批通道**端到端（P10a）：真 HTTP 链路 → 真库 RLS → 真 Redis →
//! 真 JWT → 进程内 durable 运行时 → compute(桩)。
//!
//! 闸门是「模型想写、人说了算」那一段。这条用例守四件事：
//!
//! 1. **批了才执行、驳了不执行**：受保护的工具只有一条执行路径（下游的
//!    `/agents/tool-executions`），驳回与超时都走编排自己合成的结果；
//! 2. **决定只认当前那一次**：没在等、id 不符、字面量不认识，一条脏台账都不许留；
//! 3. **待审批项只活在编排里**：查询接口把编排的 custom status 投影成 `pendingApproval`，
//!    决定一落定它就消失（不然同一件事会被批第二次），任务跑完连进度串一起消失；
//! 4. **超时由编排判定**：没人处理按超时作废；谁要是投一条 `EXPIRED` 进来那是伪造，
//!    任务直接失败——「等出来的结局」不能被外人塞进来当成正常结局。
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
use cogito::orchestrations::agent::APPROVAL_QUEUE;
use cogito::utils::code::{self, auth, business, request as request_codes};
use cogito::utils::jwt::generate_token;
use support::{
    Script, StubCompute, bypass_proxy_for_local_stubs, settings, test_database_url, test_schema,
};
use tokio::sync::Mutex;
use uuid::Uuid;

/// 应用角色：`Migrator::fresh` 用超级用户建表，业务连接必须换成一个**非超级用户**，
/// 否则 `FORCE ROW LEVEL SECURITY` 会被静默绕过，跨租户的断言全部变成假绿。
const APP_ROLE: &str = "cogito_app_test";
const INTERNAL_TOKEN: &str = "test-internal-token";
const OBJECTIVE: &str = "记住客户偏好邮件联系";
const ASK: &str = "要写一条客户偏好笔记";
const ANSWER: &str = "已按现有信息作答。";
const CHAT_MODEL: &str = "agent-test-model";
const EMBED_MODEL: &str = "test-embedding-model";
const TOOL_KNOWLEDGE: &str = "knowledge_search";
/// 要审批的工具：写数据那种，做错了收不回来。
const TOOL_WRITE: &str = "memory_write";
/// 模型给的参数**原文**：人批的就是这一份，执行时照它执行。
const ARGUMENTS: &str = r#"{"note":"客户偏好邮件联系"}"#;
const REASON: &str = "这条笔记不该写进去";
/// 部署级轮次上限。压到 3 才能看出「最后一轮不再给工具」。
const MAX_STEPS: usize = 3;
/// 长 TTL：用例要慢慢折腾各种坏输入，批不完还得有得等。
const LONG_TTL_SECS: u64 = 600;
/// 短 TTL：专门用来演「没人处理」。
const SHORT_TTL_SECS: u64 = 1;

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

/// 轮询查询接口直到它报出待审批项。
///
/// 只在**长 TTL** 的用例里用：短 TTL 的窗口比一次轮询还短，等它就是在掷骰子。
macro_rules! wait_for_pending {
    ($app:expr, $token:expr, $tenant:expr, $id:expr) => {
        async {
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let (status, body) = call!($app, get_task($token, $tenant, &$id)).await;
                assert_eq!(status, 200, "查询任务失败：{body}");
                assert!(
                    body["success"].as_bool().unwrap_or(false),
                    "查询任务失败：{body}"
                );

                let data = body["data"].clone();
                if data["pendingApproval"].is_object() {
                    break data;
                }
                assert!(
                    data["status"].as_str() == Some("RUNNING"),
                    "任务没在等审批就已经收了尾：{data}"
                );
                assert!(Instant::now() < deadline, "等任务挂出待审批超时：{data}");

                tokio::time::sleep(Duration::from_millis(20)).await;
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

/// `ttl_secs` 是这一轮部署的审批有效期——超时那一条用例只能靠它来缩短等待。
async fn setup(ttl_secs: u64) -> Option<Fixture> {
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
    config.agent.approval_ttl_secs = ttl_secs;
    // 只放开两个：一个查、一个写，写那个正是要审批的。
    config.agent.allowed_tools = vec![TOOL_KNOWLEDGE.to_owned(), TOOL_WRITE.to_owned()];
    config.compute.token = INTERNAL_TOKEN.to_owned();
    config.compute.embed_model = EMBED_MODEL.to_owned();

    let secret = config.security.jwt_secret.clone();

    let tenant = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let user = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let suffix = &Uuid::new_v4().simple().to_string()[..8];

    for (id, tag) in [
        (tenant, format!("approval-{suffix}-a")),
        (stranger, format!("approval-{suffix}-b")),
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
        (user, format!("approval-{suffix}-u"), "USER"),
        (outsider, format!("approval-{suffix}-o"), "USER"),
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
            "approval-ctx-user",
            PlatformRole::User,
            &secret,
            None,
        )
        .expect("签发令牌失败"),
        outsider_token: generate_token(
            &outsider.to_string(),
            "approval-ctx-outsider",
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
// 运行时与桩
// ---------------------------------------------------------------------------

/// 起一条进程内 durable 运行时：编排、活动、桩下游都由这一份脚本驱动。
///
/// 运行时与 store 都交还给调用点——一个是「别提前 drop」，另一个是收尾清理要用。
async fn start_runtime(script: Script) -> (StubCompute, Runtime, Store) {
    let uri = test_database_url().expect("已确认设置");
    let store = Store::connect(&settings(&uri, &test_schema()))
        .await
        .expect("连接 durable schema 失败");

    let stub = StubCompute::start(script).await;
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

    (stub, runtime, store)
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

fn post_decision(
    token: Option<&str>,
    tenant: Option<&str>,
    task: &str,
    approval_id: &str,
    payload: &Value,
) -> test::TestRequest {
    let mut request = test::TestRequest::post().uri(
        &paths::AGENT_TASK_APPROVAL
            .replace("{id}", task)
            .replace("{approvalID}", approval_id),
    );

    if let Some(token) = token {
        request = request.insert_header(("Authorization", format!("Bearer {token}")));
    }
    if let Some(tenant) = tenant {
        request = request.insert_header(("X-Tenant-ID", tenant.to_owned()));
    }

    request.set_json(payload)
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

fn usage() -> AgentUsage {
    AgentUsage {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
    }
}

/// 模型提出一次要审批的写调用。
///
/// 关键在下游只回**占位**结果：`awaitingApproval` 为真，正文是空的，`ok` 是假。
/// 这一份不进历史——真结果要在人批完之后才有。
fn ask(call_id: &str) -> AgentStepResponse {
    AgentStepResponse {
        schema_version: INTERNAL_SCHEMA_VERSION,
        finished: false,
        message: AgentMessage {
            role: "assistant".to_owned(),
            content: Some(ASK.to_owned()),
            tool_calls: Some(vec![AgentToolCall {
                id: call_id.to_owned(),
                name: TOOL_WRITE.to_owned(),
                arguments: Some(ARGUMENTS.to_owned()),
                tool_call_type: Some("function".to_owned()),
            }]),
            tool_call_id: None,
        },
        tool_results: vec![AgentToolResult {
            tool_call_id: call_id.to_owned(),
            name: TOOL_WRITE.to_owned(),
            ok: false,
            content: String::new(),
            error: None,
            awaiting_approval: Some(true),
        }],
        usage: usage(),
    }
}

/// 模型给出结论。
fn answer() -> AgentStepResponse {
    AgentStepResponse {
        schema_version: INTERNAL_SCHEMA_VERSION,
        finished: true,
        message: AgentMessage {
            role: "assistant".to_owned(),
            content: Some(ANSWER.to_owned()),
            tool_calls: None,
            tool_call_id: None,
        },
        tool_results: Vec::new(),
        usage: usage(),
    }
}

fn step_json(response: &AgentStepResponse) -> Value {
    serde_json::to_value(response).expect("单步响应必须可序列化")
}

/// 审批台账里这一任务两列拼成的可核对快照：`状态|工具|理由|决定人`，按步号排。
///
/// 一行都没有时给 `None`——「没记录」和「记了一堆空值」是两件事。
async fn ledger_of(db: &DatabaseConnection, task_id: &str) -> Option<String> {
    scalar(
        db,
        &format!(
            r#"SELECT coalesce(
                   string_agg(
                       state || '|' || tool || '|' || coalesce(reason, '')
                             || '|' || coalesce("decidedBy"::text, ''),
                       ' ; ' ORDER BY step
                   ),
                   ''
               )
               FROM agent_approval WHERE "taskID" = '{task_id}'"#
        ),
    )
    .await
    .filter(|joined| !joined.is_empty())
}

/// 整张台账的行数：跨任务的用例靠它确认「一条脏记录都不许留」。
async fn ledger_count(db: &DatabaseConnection) -> i64 {
    scalar(db, "SELECT count(*)::text FROM agent_approval")
        .await
        .expect("统计审批台账失败")
        .parse()
        .expect("计数必须是数字")
}

// ---------------------------------------------------------------------------
// 用例 1：批准真的执行，驳回只留一条「没执行」
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn approving_runs_the_call_and_rejecting_does_not() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup(LONG_TTL_SECS).await else {
        return;
    };

    let (stub, runtime, store) = start_runtime(Script::agent(vec![
        step_json(&ask("call-1")),
        step_json(&ask("call-2")),
        step_json(&answer()),
    ]))
    .await;
    let client = store.client();
    let app = build_app!(fixture, Some(Arc::new(client.clone())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": MAX_STEPS, "tools": [TOOL_WRITE] }),
        ),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(data["allowedTools"], json!([TOOL_WRITE]));
    let task = data["id"].as_str().expect("任务 id").to_owned();
    let instance = format!("agent-{task}");
    let first = format!("{task}:1:0");
    let second = format!("{task}:2:0");

    // ---- 1. 第一步挂出待审批：查询接口要能看见「在等哪一次调用」，连模型给的原参数一起
    stub.wait_for("/agents/steps", 1, Duration::from_secs(30))
        .await;
    let data = wait_for_pending!(app, token, tenant, task).await;
    assert_eq!(data["status"], "RUNNING");
    assert_eq!(data["steps"], json!(1));
    assert_eq!(data["pendingApproval"]["approvalID"], first);
    assert_eq!(data["pendingApproval"]["step"], json!(1));
    assert_eq!(data["pendingApproval"]["tool"], TOOL_WRITE);
    assert_eq!(
        data["pendingApproval"]["arguments"], ARGUMENTS,
        "人批的是这一份具体调用，参数必须原样可见"
    );
    assert!(
        data["pendingApproval"]["expiresAt"]
            .as_i64()
            .is_some_and(|at| at > 0),
        "待审批项必须带逾期时间：{data}"
    );

    // 进度串是**加法式**扩展：老前缀格式不变，审批段拼在后面（老客户端照样读得出第几步）。
    let progress = data["progress"].as_str().expect("实时进度");
    assert!(
        progress.starts_with(&format!("step:1/{MAX_STEPS} tools:1")),
        "进度前缀不该变：{progress}"
    );
    assert!(
        progress.contains(" approval:"),
        "审批段必须挂在后面：{progress}"
    );

    // 只是「挂着」，一点活都没干
    assert_eq!(
        stub.count("/agents/tool-executions"),
        0,
        "人还没说话，谁都不许执行"
    );
    assert_eq!(ledger_count(&fixture.admin).await, 0);

    // ---- 2. 批准：这一次调用真的执行（受保护工具的唯一执行入口）
    let (status, body) = call!(
        app,
        post_decision(
            Some(token),
            Some(tenant),
            &task,
            &first,
            &json!({ "decision": "APPROVED" }),
        ),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(body["msg"], "审批决定已记录");
    assert_eq!(data["taskID"], task);
    assert_eq!(data["approvalID"], first);
    assert_eq!(data["decision"], "APPROVED");
    assert_eq!(data["applied"], json!(true), "第一次提交必须真的落定");
    assert!(
        data["decidedAt"].as_i64().is_some_and(|at| at > 0),
        "决定要有时刻：{body}"
    );

    // ---- 3. 同方向重复提交：幂等。要么「已经落定过了」，要么「已经不是待审批」了
    let (status, body) = call!(
        app,
        post_decision(
            Some(token),
            Some(tenant),
            &task,
            &first,
            &json!({ "decision": "APPROVED" }),
        ),
    )
    .await;
    if status == 200 {
        let data = assert_success(&body, status);
        assert_eq!(
            data["applied"],
            json!(false),
            "重复提交不该再落定一次：{body}"
        );
    } else {
        let msg = assert_failure(&body, status, 409, business::agent::APPROVAL_NOT_PENDING);
        assert!(msg.contains("没有在等审批"), "{msg}");
    }

    // ---- 4. 执行请求的形状：批的是一次具体调用，参数、类型都照抄人批过的那一份
    stub.wait_for("/agents/tool-executions", 1, Duration::from_secs(30))
        .await;
    let executions = stub.matching("/agents/tool-executions");
    assert_eq!(executions.len(), 1, "批一次只许执行一次");
    let execution = &executions[0];
    assert_eq!(execution.internal_token(), INTERNAL_TOKEN);
    assert!(
        execution
            .path
            .ends_with("/internal/v1/agents/tool-executions"),
        "执行请求打错了地方：{}",
        execution.path
    );
    assert_eq!(
        execution.idempotency_key(),
        format!("{instance}:approval:{first}"),
        "审批执行有自己的幂等键：同一份决定重投不该执行两次"
    );
    let payload = execution.json();
    assert_eq!(payload["schemaVersion"], json!(INTERNAL_SCHEMA_VERSION));
    assert_eq!(payload["tenantID"], tenant);
    assert_eq!(payload["taskID"], task);
    assert_eq!(payload["approvalID"], first);
    assert_eq!(payload["embedModel"], EMBED_MODEL);
    assert_eq!(payload["allowedTools"], json!([TOOL_WRITE]));
    assert_eq!(
        payload["toolCall"],
        json!({
            "id": "call-1",
            "name": TOOL_WRITE,
            "arguments": ARGUMENTS,
            "toolCallType": "function",
        }),
        "执行的是人批过的那一份原文，不是「一个意思」"
    );

    // ---- 5. 第二步带着真结果继续：历史里是「助手要调用 + 工具的执行结果」，占位结果不留痕
    stub.wait_for("/agents/steps", 2, Duration::from_secs(30))
        .await;
    let requests = stub.matching("/agents/steps");
    let second_request = requests[1].json();
    assert_eq!(second_request["remainingSteps"], json!(2));
    let history = second_request["history"]
        .as_array()
        .expect("第二步必须带历史")
        .clone();
    assert_eq!(history.len(), 2, "占位结果不许进历史：{second_request}");
    assert_eq!(
        history[0],
        json!({
            "role": "assistant",
            "content": ASK,
            "toolCalls": [{
                "id": "call-1",
                "name": TOOL_WRITE,
                "arguments": ARGUMENTS,
                "toolCallType": "function",
            }],
        })
    );
    assert_eq!(
        history[1],
        json!({
            "role": "tool",
            "content": format!("{TOOL_WRITE} 执行完成（桩）"),
            "toolCallID": "call-1",
        }),
        "工具消息只有正文与调用 id，没有别的字段"
    );

    // ---- 6. 第二步也挂审批，这次驳回（字面量故意给小写，看它怎么入库）
    let data = wait_for_pending!(app, token, tenant, task).await;
    assert_eq!(data["pendingApproval"]["approvalID"], second);
    assert_eq!(data["pendingApproval"]["step"], json!(2));

    let (status, body) = call!(
        app,
        post_decision(
            Some(token),
            Some(tenant),
            &task,
            &second,
            &json!({ "decision": "rejected", "reason": REASON }),
        ),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(data["decision"], "REJECTED", "人的决定入库前要规范化成大写");
    assert_eq!(data["applied"], json!(true));

    // ---- 7. 终态：驳回不是失败，它只是「这一次没执行」
    let data = wait_for_terminal!(app, token, tenant, task).await;
    assert_eq!(data["status"], "SUCCEEDED");
    assert_eq!(data["steps"], json!(MAX_STEPS));
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["progress"], json!(null), "跑完的任务不该还留着进度串");
    assert_eq!(
        data["pendingApproval"],
        json!(null),
        "决定落定后待审批项必须立刻消失，否则同一件事会被批第二次"
    );
    assert_eq!(data["result"]["finished"], json!(true));
    assert_eq!(data["result"]["toolCalls"], json!(2));
    assert_eq!(data["result"]["answer"], ANSWER);
    assert_eq!(data["result"]["memoryID"], json!(support::MEMORY_ID));
    assert_eq!(
        data["result"]["approvals"],
        json!([
            { "approvalID": first, "step": 1, "tool": TOOL_WRITE, "decision": "APPROVED" },
            {
                "approvalID": second,
                "step": 2,
                "tool": TOOL_WRITE,
                "decision": "REJECTED",
                "reason": REASON,
            },
        ]),
        "结果快照要留下「人做过什么决定」：事后审计靠它"
    );

    // ---- 8. 第三步读得到「那次没执行」：模型要能自己改道，而不是以为写成功了
    assert_eq!(
        stub.count("/agents/steps"),
        3,
        "驳回之后任务要继续跑，不是就地失败"
    );
    let requests = stub.matching("/agents/steps");
    let third = requests[2].json();
    assert_eq!(third["remainingSteps"], json!(1));
    assert_eq!(
        third["allowedTools"],
        json!([]),
        "最后一轮不再给工具：调用也没有下一轮可以交代了"
    );
    let history = third["history"]
        .as_array()
        .expect("第三步必须带历史")
        .clone();
    assert_eq!(history.len(), 4, "两次调用各留「助手 + 工具」一条");
    assert_eq!(history[2]["toolCalls"][0]["id"], "call-2");
    assert_eq!(history[3]["toolCallID"], "call-2");
    let content = history[3]["content"].as_str().expect("合成结果必须有正文");
    assert!(content.contains("人工审批被驳回"), "{content}");
    assert!(content.contains(REASON), "驳回理由要交给模型：{content}");
    assert!(
        content.contains("不要再提交同一个调用"),
        "得告诉模型别重试，换个做法：{content}"
    );
    assert!(
        history[3].get("error").is_none(),
        "机器码只给日志看，不进模型历史：{content}"
    );

    // ---- 9. 幂等键可复现：一轮一个键，审批执行另外带自己的键
    assert_eq!(
        stub.idempotency_keys("/agents/steps"),
        vec![
            format!("{instance}:step:1"),
            format!("{instance}:step:2"),
            format!("{instance}:step:3"),
        ]
    );
    assert_eq!(
        stub.idempotency_keys("/agents/tool-executions"),
        vec![format!("{instance}:approval:{first}")]
    );

    // ---- 10. 台账：只记**人做过什么决定**，两次都在，理由与决定人都落库
    assert_eq!(
        ledger_of(&fixture.admin, &task).await,
        Some(format!(
            "APPROVED|{TOOL_WRITE}||{} ; REJECTED|{TOOL_WRITE}|{REASON}|{}",
            fixture.user, fixture.user
        )),
        "台账是审计的唯一凭据：谁、在第几步、批了什么"
    );
    assert_eq!(
        scalar(
            &fixture.admin,
            &format!("SELECT arguments FROM agent_approval WHERE id = '{first}'"),
        )
        .await
        .as_deref(),
        Some(ARGUMENTS),
        "台账里存的是模型给的原参数：执行时照它执行，事后照它对账"
    );
    assert_eq!(
        scalar(
            &fixture.admin,
            "SELECT count(*)::text FROM agent_approval WHERE \"appliedAt\" IS NULL",
        )
        .await
        .as_deref(),
        Some("0"),
        "决定最终都要送进编排邮箱，不能留「已落定但没投递」的悬案"
    );
    assert_eq!(
        stub.count("/agents/tool-executions"),
        1,
        "驳回之后一次都不许再执行"
    );

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}

// ---------------------------------------------------------------------------
// 用例 2：没人处理就作废，一次都不执行
// ---------------------------------------------------------------------------

/// 等不到人的那次调用必须**作废**，而不是永远挂着：编排自己的时钟说了算。
///
/// 这里刻意不去等「它挂出来了」——TTL 只有 1 秒，窗口比一次轮询还短，等它就是在掷骰子。
/// 要验的是结局：工具没执行、任务照样跑完、快照里记的是 `EXPIRED` 而不是某个人的决定。
#[actix_web::test]
async fn an_unanswered_approval_expires_and_nothing_is_executed() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup(SHORT_TTL_SECS).await else {
        return;
    };

    let (stub, runtime, store) = start_runtime(Script::agent(vec![
        step_json(&ask("call-1")),
        step_json(&answer()),
    ]))
    .await;
    let client = store.client();
    let app = build_app!(fixture, Some(Arc::new(client.clone())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": 2, "tools": [TOOL_WRITE] }),
        ),
    )
    .await;
    let task = assert_success(&body, status)["id"]
        .as_str()
        .expect("任务 id")
        .to_owned();

    let data = wait_for_terminal!(app, token, tenant, task).await;
    assert_eq!(
        data["status"], "SUCCEEDED",
        "超时不是任务失败：模型拿到「没执行」的结果接着跑"
    );
    assert_eq!(data["steps"], json!(2));
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["pendingApproval"], json!(null), "作废了就不该还挂着");

    assert_eq!(data["result"]["finished"], json!(true));
    assert_eq!(data["result"]["toolCalls"], json!(1));
    assert_eq!(data["result"]["answer"], ANSWER);

    let approvals = data["result"]["approvals"]
        .as_array()
        .expect("超时也是一次审批")
        .clone();
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0]["approvalID"], format!("{task}:1:0"));
    assert_eq!(approvals[0]["decision"], "EXPIRED");
    assert_eq!(approvals[0]["step"], json!(1));
    assert!(
        approvals[0].get("reason").is_none(),
        "没理由就是没理由：没人说过话，不该编一个出来"
    );

    assert_eq!(
        stub.count("/agents/tool-executions"),
        0,
        "没人批就不许执行——这是整条通道存在的意义"
    );
    assert_eq!(
        ledger_count(&fixture.admin).await,
        0,
        "超时是编排等出来的结局，不是人做的决定，不落台账"
    );

    // 第二步的历史里是编排合成的「没执行」结果
    let requests = stub.matching("/agents/steps");
    assert_eq!(requests.len(), 2);
    let history = requests[1].json()["history"]
        .as_array()
        .expect("第二步必须带历史")
        .clone();
    assert_eq!(history.len(), 2);
    assert_eq!(history[1]["toolCallID"], "call-1");
    let content = history[1]["content"].as_str().expect("合成结果必须有正文");
    assert!(content.contains("超时"), "{content}");
    assert!(content.contains("不要再提交同一个调用"), "{content}");
    assert!(history[1].get("error").is_none(), "{content}");

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}

// ---------------------------------------------------------------------------
// 用例 3：决定被「在等」、「租户」、「词汇」三道关守着
// ---------------------------------------------------------------------------

/// 决定端点是一条**写**通路，坏输入必须在落库之前挡下。
///
/// 三类把关：鉴权与作用域（谁的租户）、状态（现在到底在等哪一次）、词汇（人只能说批或驳）。
/// 全程只有最后那次正确的提交能留下痕迹——一条脏台账都不许有。
#[actix_web::test]
async fn decisions_are_guarded_by_pending_state_tenancy_and_vocabulary() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup(LONG_TTL_SECS).await else {
        return;
    };

    let (stub, runtime, store) = start_runtime(Script::agent(vec![
        step_json(&ask("call-1")),
        step_json(&answer()),
    ]))
    .await;
    let client = store.client();
    let app = build_app!(fixture, Some(Arc::new(client.clone())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());
    let outsider = fixture.outsider_token.as_str();

    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": 2, "tools": [TOOL_WRITE] }),
        ),
    )
    .await;
    let task = assert_success(&body, status)["id"]
        .as_str()
        .expect("任务 id")
        .to_owned();
    let first = format!("{task}:1:0");

    let data = wait_for_pending!(app, token, tenant, task).await;
    assert_eq!(data["pendingApproval"]["approvalID"], first);
    let approved = json!({ "decision": "APPROVED" });

    // 没令牌：鉴权在所有业务判断之前
    let (status, body) = call!(
        app,
        post_decision(None, Some(tenant), &task, &first, &approved),
    )
    .await;
    assert_failure(&body, status, 401, auth::NOT_LOGGED_IN);

    // 少了租户头：作用域定不下来，连查都不许查
    let (status, body) = call!(
        app,
        post_decision(Some(token), None, &task, &first, &approved),
    )
    .await;
    assert_failure(&body, status, 400, request_codes::MISSING_PARAMETER);

    // 别的租户的成员：拿我们的租户头也没门
    let (status, body) = call!(
        app,
        post_decision(Some(outsider), Some(tenant), &task, &first, &approved),
    )
    .await;
    assert_failure(&body, status, 403, auth::ACCESS_DENIED);

    // 令牌是真的、角色也够，但缺写权限之外的坏 id：先撞 UUID 解析
    let (status, body) = call!(
        app,
        post_decision(Some(token), Some(tenant), "not-a-uuid", &first, &approved),
    )
    .await;
    let msg = assert_failure(&body, status, 404, business::agent::TASK_NOT_FOUND);
    assert_eq!(msg, "任务不存在", "坏 id 与「不是我的任务」回同一个答案");

    // 另一个租户的任务：RLS 让它对本租户根本不存在，同样 404
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
    let (status, body) = call!(
        app,
        post_decision(
            Some(token),
            Some(tenant),
            &foreign.to_string(),
            &first,
            &approved
        ),
    )
    .await;
    assert_failure(&body, status, 404, business::agent::TASK_NOT_FOUND);

    // 决定只认**当前正在等的那一次**：别的 id 一律 409
    for wrong in [
        format!("{task}:9:9"),
        format!("{task}:1:1"),
        format!("{task}:0:0"),
        format!("{foreign}:1:0"),
    ] {
        let (status, body) = call!(
            app,
            post_decision(Some(token), Some(tenant), &task, &wrong, &approved),
        )
        .await;
        let msg = assert_failure(&body, status, 409, business::agent::APPROVAL_NOT_PENDING);
        assert!(msg.contains("没有在等待审批"), "{wrong}：{msg}");
    }

    // 人只能批或驳：`EXPIRED` 是编排等出来的结局，不是人能给的
    for literal in ["EXPIRED", "maybe", "", "  "] {
        let (status, body) = call!(
            app,
            post_decision(
                Some(token),
                Some(tenant),
                &task,
                &first,
                &json!({ "decision": literal }),
            ),
        )
        .await;
        let msg = assert_failure(
            &body,
            status,
            422,
            business::agent::APPROVAL_DECISION_INVALID,
        );
        assert!(msg.contains("APPROVED 或 REJECTED"), "{literal:?}：{msg}");
    }

    // 折腾了这么多，一条脏台账、一次执行都不许留
    assert_eq!(ledger_count(&fixture.admin).await, 0);
    assert_eq!(stub.count("/agents/tool-executions"), 0);

    // 闸门还在等——正确的决定最终还是生效
    let (status, body) = call!(
        app,
        post_decision(Some(token), Some(tenant), &task, &first, &approved),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(data["decision"], "APPROVED");
    assert_eq!(data["applied"], json!(true));

    let data = wait_for_terminal!(app, token, tenant, task).await;
    assert_eq!(data["status"], "SUCCEEDED");
    assert_eq!(data["steps"], json!(2));
    assert_eq!(stub.count("/agents/tool-executions"), 1);
    assert_eq!(
        ledger_of(&fixture.admin, &task).await,
        Some(format!("APPROVED|{TOOL_WRITE}||{}", fixture.user)),
        "只有那一次正确的提交留下了记录"
    );

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}

// ---------------------------------------------------------------------------
// 用例 4：不相干的决定被忽略，伪造的结局让任务失败
// ---------------------------------------------------------------------------

/// 邮箱是先到先得的**公共**信道：编排只能靠 id 认出「这条决定是我这一次的吗」。
///
/// 两种外人塞进来的东西要分得清清楚楚：
/// - id 对不上 → 不是给我的，忽略，继续等（不能顶掉我正等的那一次）；
/// - id 对上了但结局是 `EXPIRED` → 那是伪造（超时只能由编排自己等出来），任务失败。
#[actix_web::test]
async fn foreign_decisions_are_ignored_and_forged_expiry_fails_the_task() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup(LONG_TTL_SECS).await else {
        return;
    };

    // `/agents/steps` 的桩序号是全局共享的（按请求顺序发脚本），所以两个任务必须一前一后。
    let (stub, runtime, store) = start_runtime(Script::agent(vec![
        step_json(&ask("a-call-1")),
        step_json(&answer()),
        step_json(&ask("b-call-1")),
        step_json(&answer()),
    ]))
    .await;
    let client = store.client();
    let app = build_app!(fixture, Some(Arc::new(client.clone())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // ---- 任务 A：先跑完
    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": 2, "tools": [TOOL_WRITE] }),
        ),
    )
    .await;
    let task_a = assert_success(&body, status)["id"]
        .as_str()
        .expect("任务 id")
        .to_owned();
    let instance_a = format!("agent-{task_a}");
    let approval_a = format!("{task_a}:1:0");

    let data = wait_for_pending!(app, token, tenant, task_a).await;
    assert_eq!(data["pendingApproval"]["approvalID"], approval_a);

    // 投一条**不是本次**的决定：编排必须忽略它继续等，而不是把它当成自己的结局
    client
        .enqueue_event_json(
            &instance_a,
            APPROVAL_QUEUE,
            &json!({ "approvalID": format!("{task_a}:9:9"), "decision": "APPROVED" }).to_string(),
        )
        .await
        .expect("投递伪造决定失败");
    tokio::time::sleep(Duration::from_secs(1)).await;

    let (status, body) = call!(app, get_task(token, tenant, &task_a)).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "RUNNING", "不相干的决定不该让任务动起来");
    assert_eq!(
        data["pendingApproval"]["approvalID"], approval_a,
        "待审批项不该被别人的决定顶掉"
    );
    assert_eq!(
        stub.count("/agents/tool-executions"),
        0,
        "没人批过，不许执行"
    );
    assert_eq!(ledger_count(&fixture.admin).await, 0);

    // 真决定来了，闸门照常放行
    let (status, body) = call!(
        app,
        post_decision(
            Some(token),
            Some(tenant),
            &task_a,
            &approval_a,
            &json!({ "decision": "APPROVED" }),
        ),
    )
    .await;
    assert_success(&body, status);

    let data = wait_for_terminal!(app, token, tenant, task_a).await;
    assert_eq!(data["status"], "SUCCEEDED");
    assert_eq!(data["result"]["approvals"][0]["decision"], "APPROVED");
    assert_eq!(stub.count("/agents/tool-executions"), 1);

    // ---- 任务 B：投一条伪造的超时
    let (status, body) = call!(
        app,
        post_task(
            Some(token),
            Some(tenant),
            &json!({ "objective": OBJECTIVE, "maxSteps": 2, "tools": [TOOL_WRITE] }),
        ),
    )
    .await;
    let task_b = assert_success(&body, status)["id"]
        .as_str()
        .expect("任务 id")
        .to_owned();
    let instance_b = format!("agent-{task_b}");
    let approval_b = format!("{task_b}:1:0");

    let data = wait_for_pending!(app, token, tenant, task_b).await;
    assert_eq!(data["pendingApproval"]["approvalID"], approval_b);

    client
        .enqueue_event_json(
            &instance_b,
            APPROVAL_QUEUE,
            &json!({ "approvalID": approval_b, "decision": "EXPIRED" }).to_string(),
        )
        .await
        .expect("投递伪造超时失败");

    let data = wait_for_terminal!(app, token, tenant, task_b).await;
    assert_eq!(
        data["status"], "FAILED",
        "伪造的结局必须让任务失败，「等出来的结局」不能从外面塞进来"
    );
    let error = data["error"].as_str().expect("失败任务必须有原因");
    assert!(error.contains("审批决定不能是 EXPIRED"), "{error}");
    assert_eq!(data["result"], json!(null), "没跑出结论就没有结果快照");

    assert_eq!(
        stub.count("/agents/tool-executions"),
        1,
        "B 的工具一次都没执行"
    );
    assert_eq!(
        ledger_of(&fixture.admin, &task_b).await,
        None,
        "超时不落台账：没人的决定可记"
    );
    assert_eq!(
        ledger_count(&fixture.admin).await,
        1,
        "全局只有 A 那一条审批记录"
    );

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}
