//! rag 索引任务的用户面端到端：真 HTTP 链路 → 真库 RLS → 真 Redis → 真 JWT →
//! 进程内 durable 运行时 → ai-worker（桩）。
//!
//! `rag.index-asset` 此前只有编排自己的用例（`tests/rag_index.rs` 直接 `client.start`），
//! 没有生产入口——这条长任务能在生产里被起起来，靠的是本文件覆盖的那条链路。它守五件事：
//!
//! 1. 越权与不可索引的资产在**建行之前**就被挡下（一条脏台账都不许留）；
//! 2. 编排起不来时台账如实说「失败」，而不是留一条永远 `RUNNING` 的记录；
//! 3. 别的租户的任务与不存在一样，都回同一个 404（不泄露存在性）；
//! 4. 「分块 → 分批嵌入 → 落索引」真的按批跑完，出站报文形状与幂等键可复现；
//! 5. 并发闸门只挡 `RUNNING`，终态行不占位（同一资产重跑是合法操作）。
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
use cogito::clients::ai_worker::{AiWorkerClient, INTERNAL_SCHEMA_VERSION};
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
    Script, StubAiWorker, bypass_proxy_for_local_stubs, settings, test_database_url, test_schema,
    wait_for_custom_status,
};
use tokio::sync::Mutex;
use uuid::Uuid;

/// 应用角色：`Migrator::fresh` 用超级用户建表，业务连接必须换成一个**非超级用户**，
/// 否则 `FORCE ROW LEVEL SECURITY` 会被静默绕过，跨租户的断言全部变成假绿。
const APP_ROLE: &str = "cogito_app_test";
const INTERNAL_TOKEN: &str = "test-internal-token";
const EMBED_MODEL: &str = "test-embedding-model";
/// 批大小与块数取整除，嵌入区间才是整齐的三条（48 / 16 = 3）。
const BATCH: usize = 16;
const CHUNKS: i32 = 48;
const DIMENSIONS: i32 = 1536;
/// 桩的默认块集 id 与集合名，编排会把它们原样带进后续请求与最终结果快照。
const CHUNK_SET: &str = "chunk-set-0001";
const COLLECTION: &str = "stub_chunks";
const MIME: &str = "text/plain";
const NAME: &str = "handbook.md";

/// 台账里记的失败原因（面向运维）。
const LEDGER_OFFLINE: &str = "编排运行时未接通（durable 未配置或连接失败）";
/// 响应里给调用方的解释：只有「暂时起不了」这一句。
///
/// 刻意与台账那句不同——`RUNTIME_OFFLINE` 里带着「运行时没接上」这类内部线索，回给调用方
/// 就等于把部署拓扑说出去；排查线索留在日志里（见 `services/rag/error.rs`）。
const RESPONSE_OFFLINE: &str = "编排服务暂时不可用，请稍后重试";
/// 台账写着 `RUNNING` 但编排里没有这个实例、且行龄超宽限期的判定文案。
const INSTANCE_GONE: &str = "编排实例已不存在（任务记录仍在，未跑完）";

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
        let ai_worker: Option<Arc<cogito::clients::ai_worker::AiWorkerClient>> = None;

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

/// 轮询 `GET /rag/index-tasks/{id}` 直到台账落到终态。
///
/// 终态由「编排跑完」和「等待者结算」两步共同决定，没有确定的时刻可以等，只能轮询。
macro_rules! wait_for_terminal {
    ($app:expr, $token:expr, $tenant:expr, $id:expr) => {
        async {
            let deadline = Instant::now() + Duration::from_secs(60);
            loop {
                let (status, body) = call!($app, get_index_task($token, $tenant, &$id)).await;
                let data = assert_success(&body, status).clone();
                if data["status"].as_str() != Some("RUNNING") {
                    break data;
                }
                assert!(Instant::now() < deadline, "等索引任务落到终态超时：{data}");

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
    /// 可以索引的资产（已完成上传、未归档）。
    ready: Uuid,
    /// 还在上传中：存在，但当前不可索引。
    uploading: Uuid,
    /// 已归档：对用户侧而言已经不存在，本域按 404 处理。
    archived: Uuid,
    /// 别的租户的资产：跨租户也必须 404。
    foreign: Uuid,
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

/// 某租户名下的台账行数。用超级用户连接查，绕开 RLS——断言的是「库里到底有几行」。
async fn ledger_count(db: &DatabaseConnection, tenant: Uuid) -> String {
    scalar(
        db,
        &format!(r#"SELECT count(*)::text FROM rag_index_task WHERE "tenantID" = '{tenant}'"#),
    )
    .await
    .expect("count 应当有结果")
}

/// 台账某一列的可空文本值（NULL 与空串都当「没有」；用例里不写空串）。
async fn ledger_field(db: &DatabaseConnection, id: &str, column: &str) -> Option<String> {
    scalar(
        db,
        &format!(r#"SELECT COALESCE("{column}"::text, '') FROM rag_index_task WHERE id = '{id}'"#),
    )
    .await
    .filter(|value| !value.is_empty())
}

/// 取租户下唯一那一行的 id（只在只可能有一行的地方用）。
async fn only_task_id(db: &DatabaseConnection, tenant: Uuid) -> String {
    scalar(
        db,
        &format!(r#"SELECT id::text FROM rag_index_task WHERE "tenantID" = '{tenant}'"#),
    )
    .await
    .expect("台账应当有一行")
}

/// 直插一条资产。`creator` 决定 RLS 的可见性：异租户资产必须把创建者设成**外人**，
/// 否则本用户仍能凭 `creator = 我` 看见它，「跨租户 404」就成了假绿。
async fn insert_asset(
    db: &DatabaseConnection,
    id: Uuid,
    tenant: Uuid,
    creator: Uuid,
    status: &str,
    archived: bool,
) {
    let archived_at = if archived { "now()" } else { "NULL" };
    // hash 只是给资产一个可辨识的标识，用它派生以免两条资产撞上同一个哈希。
    let hash = format!("{}-{id}", &id.simple().to_string()[..8]);

    exec(
        db,
        &format!(
            r#"INSERT INTO asset (id, "tenantID", hash, size, "index", mime, name, status,
                                  visibility, chunk, total, "archivedAt", "createdAt",
                                  creator, "updatedAt")
               VALUES ('{id}', '{tenant}', '{hash}', 1024, 0, '{MIME}', '{NAME}', '{status}',
                       'PRIVATE', 1024, 1, {archived_at}, now(), '{creator}', now())"#
        ),
    )
    .await;
}

/// 直插一条台账行：用来伪造「已经有任务在跑 / 已经跑完」这类前置状态。
async fn insert_task(
    db: &DatabaseConnection,
    id: Uuid,
    tenant: Uuid,
    asset: Uuid,
    creator: Uuid,
    status: &str,
    age: &str,
) {
    exec(
        db,
        &format!(
            r#"INSERT INTO rag_index_task (id, "tenantID", "userID", "assetID", status,
                                           "instanceID", "createdAt", "updatedAt")
               VALUES ('{id}', '{tenant}', '{creator}', '{asset}', '{status}',
                       'rag-index-{id}', now() - interval '{age}', now() - interval '{age}')"#
        ),
    )
    .await;
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
    config.ai_worker.token = INTERNAL_TOKEN.to_owned();
    config.ai_worker.embed_model = EMBED_MODEL.to_owned();
    config.ai_worker.embed_batch_size = BATCH;

    let secret = config.security.jwt_secret.clone();

    let tenant = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let user = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let suffix = &Uuid::new_v4().simple().to_string()[..8];

    for (id, tag) in [
        (tenant, format!("rag-{suffix}-a")),
        (stranger, format!("rag-{suffix}-b")),
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
    for (id, tag) in [
        (user, format!("rag-{suffix}-u")),
        (outsider, format!("rag-{suffix}-o")),
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

    let ready = Uuid::new_v4();
    let uploading = Uuid::new_v4();
    let archived = Uuid::new_v4();
    let foreign = Uuid::new_v4();

    insert_asset(&admin, ready, tenant, user, "COMPLETED", false).await;
    insert_asset(&admin, uploading, tenant, user, "UPLOADING", false).await;
    insert_asset(&admin, archived, tenant, user, "COMPLETED", true).await;
    insert_asset(&admin, foreign, stranger, outsider, "COMPLETED", false).await;

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
            "rag-ctx-user",
            PlatformRole::User,
            &secret,
            None,
        )
        .expect("签发令牌失败"),
        outsider_token: generate_token(
            &outsider.to_string(),
            "rag-ctx-outsider",
            PlatformRole::User,
            &secret,
            None,
        )
        .expect("签发令牌失败"),
        admin,
        tenant,
        stranger,
        user,
        ready,
        uploading,
        archived,
        foreign,
    })
}

// ---------------------------------------------------------------------------
// 请求构造与断言辅助
// ---------------------------------------------------------------------------

fn post_index_task(
    token: Option<&str>,
    tenant: Option<&str>,
    payload: &Value,
) -> test::TestRequest {
    let mut request = test::TestRequest::post().uri(paths::RAG_INDEX_TASKS);

    if let Some(token) = token {
        request = request.insert_header(("Authorization", format!("Bearer {token}")));
    }
    if let Some(tenant) = tenant {
        request = request.insert_header(("X-Tenant-ID", tenant.to_owned()));
    }

    request.set_json(payload)
}

fn get_index_task(token: &str, tenant: &str, id: &str) -> test::TestRequest {
    test::TestRequest::get()
        .uri(&paths::RAG_INDEX_TASK_BY_ID.replace("{id}", id))
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

fn payload_for(asset: Uuid) -> Value {
    json!({ "assetID": asset.to_string() })
}

/// `traceparent` 的格式（`00-<32 hex>-<16 hex>-01`）与「每一步互异」都要能机器判定，
/// 否则「链路贯通」只是一句口号。
fn assert_traceparent(value: &str) {
    let parts = value.split('-').collect::<Vec<_>>();
    assert_eq!(parts.len(), 4, "traceparent 应当是四段：{value}");
    assert_eq!(parts[0], "00", "版本号不符：{value}");
    assert_eq!(parts[1].len(), 32, "trace-id 应当是 32 位十六进制：{value}");
    assert_eq!(parts[2].len(), 16, "span-id 应当是 16 位十六进制：{value}");
    assert_eq!(parts[3], "01", "采样标志不符：{value}");
    assert!(
        parts[1].chars().all(|ch| ch.is_ascii_hexdigit())
            && parts[2].chars().all(|ch| ch.is_ascii_hexdigit()),
        "traceparent 的 id 段必须是十六进制：{value}"
    );
}

// ---------------------------------------------------------------------------
// 用例 1：坏入参与越权在建行之前挡下
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn rejects_unindexable_requests_without_touching_the_ledger() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    // durable 故意不接通：这一用例只验「还没走到起编排那一步」。
    let app = build_app!(fixture, None);

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());
    let ok = payload_for(fixture.ready);

    // 无令牌：鉴权发生在任何业务判断之前（连租户头都不看）。
    let (status, body) = call!(app, post_index_task(None, Some(tenant), &ok)).await;
    assert_failure(&body, status, 401, auth::NOT_LOGGED_IN);

    // 缺租户头：能证明身份，但作用域定不下来——资产是按租户隔离的，猜一个比报错更糟。
    let (status, body) = call!(app, post_index_task(Some(token), None, &ok)).await;
    assert_failure(&body, status, 400, request_codes::MISSING_PARAMETER);

    // 租户头不是 UUID：格式错误与「缺少」必须分开报，否则前端没法区分要补哪一个。
    let (status, body) = call!(app, post_index_task(Some(token), Some("not-a-uuid"), &ok)).await;
    assert_failure(&body, status, 400, request_codes::INVALID_HEADER);

    // 别的租户的成员拿我们的租户头：403，而不是 404。
    let (status, body) = call!(
        app,
        post_index_task(Some(fixture.outsider_token.as_str()), Some(tenant), &ok)
    )
    .await;
    assert_failure(&body, status, 403, auth::ACCESS_DENIED);

    // 缺 assetID：由框架的 JSON 拒绝兜住，同样不该落台账。
    let (status, body) = call!(app, post_index_task(Some(token), Some(tenant), &json!({}))).await;
    assert_failure(&body, status, 400, request_codes::INVALID_PARAMETER_FORMAT);

    // assetID 不是 UUID：回 404 而不是 400。对调用方而言「这个 id 找不到」才是可行动的信息，
    // 而且与「不是我的资产」同形才不会让 id 变成探测别的租户的探针。
    let (status, body) = call!(
        app,
        post_index_task(
            Some(token),
            Some(tenant),
            &json!({ "assetID": "not-a-uuid" })
        ),
    )
    .await;
    let msg = assert_failure(&body, status, 404, business::rag::ASSET_NOT_FOUND);
    assert_eq!(msg, "资产不存在");

    // 随机 UUID / 已归档 / 别的租户的资产：三种「不存在」必须同形。
    for asset in [Uuid::new_v4(), fixture.archived, fixture.foreign] {
        let (status, body) = call!(
            app,
            post_index_task(Some(token), Some(tenant), &payload_for(asset)),
        )
        .await;
        assert_failure(&body, status, 404, business::rag::ASSET_NOT_FOUND);
    }

    // 还在上传：存在但当前不可索引 → 422，且文案要能指导调用方「等它传完再试」。
    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.uploading)),
    )
    .await;
    let msg = assert_failure(&body, status, 422, business::rag::ASSET_NOT_INDEXABLE);
    assert_eq!(msg, "资产尚未完成上传，无法索引");

    // 一条脏台账都不该留：否则注定失败的任务会把「在跑」的唯一索引位占住。
    assert_eq!(ledger_count(&fixture.admin, fixture.tenant).await, "0");
}

// ---------------------------------------------------------------------------
// 用例 2：编排没接通 = 台账里一条可见的失败，不是一条永远 RUNNING 的记录
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn an_offline_orchestrator_is_recorded_as_a_failure() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    // durable 不接通：对应「api 进程起来了但可靠执行运行时没接上」这个真实事故。
    let app = build_app!(fixture, None);

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.ready)),
    )
    .await;
    let msg = assert_failure(&body, status, 503, business::rag::ORCHESTRATION_UNAVAILABLE);
    // 响应文案说的是「稍后重试」，台账里记的是内部原因——两句话面向的人不同。
    assert_eq!(msg, RESPONSE_OFFLINE);

    let task = only_task_id(&fixture.admin, fixture.tenant).await;
    assert_eq!(
        ledger_field(&fixture.admin, &task, "status")
            .await
            .as_deref(),
        Some("FAILED")
    );
    assert_eq!(
        ledger_field(&fixture.admin, &task, "error")
            .await
            .as_deref(),
        Some(LEDGER_OFFLINE)
    );
    assert_eq!(
        ledger_field(&fixture.admin, &task, "result").await,
        None,
        "失败的任务不该有结果快照"
    );
    assert_eq!(
        ledger_field(&fixture.admin, &task, "instanceID")
            .await
            .as_deref(),
        Some(format!("rag-index-{task}").as_str()),
        "实例名必须由台账 id 派生，否则续跑与幂等键都对不上"
    );

    // 台账是记录：GET 必须能把它读出来（而不是 404，也不是永远 RUNNING）。
    let (status, body) = call!(app, get_index_task(token, tenant, &task)).await;
    let data = assert_success(&body, status);
    assert_eq!(body["msg"], "获取索引任务成功");
    assert_eq!(data["status"], "FAILED");
    assert_eq!(data["progress"], json!(null));
    assert_eq!(data["error"], LEDGER_OFFLINE);
    assert_eq!(data["result"], json!(null));
    assert_eq!(data["assetID"], fixture.ready.to_string());
    assert_eq!(
        data["userID"]
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok()),
        Some(fixture.user)
    );
}

// ---------------------------------------------------------------------------
// 用例 3：跨租户同形 404，以及「实例不见了」的读时修复
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn hides_other_tenants_tasks_and_settles_orphans() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };

    let uri = test_database_url().expect("已确认设置");
    let store = Store::connect(&settings(&uri, &test_schema()))
        .await
        .expect("连接 durable schema 失败");
    // 刻意**不起**运行时：这一用例要的就是「编排里查不到这些实例」。
    let app = build_app!(fixture, Some(Arc::new(store.client())));

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // id 非法与「不是我的 id」回同一个 404：分开会让调用方拿它当租户探针。
    let (status, body) = call!(app, get_index_task(token, tenant, "not-a-uuid")).await;
    let msg = assert_failure(&body, status, 404, business::rag::TASK_NOT_FOUND);
    assert_eq!(msg, "索引任务不存在");

    let (status, body) = call!(
        app,
        get_index_task(token, tenant, &Uuid::new_v4().to_string())
    )
    .await;
    assert_failure(&body, status, 404, business::rag::TASK_NOT_FOUND);

    // 别的租户的任务：对我们的用户必须**完全不存在**，而且不能被顺手改写成失败。
    let foreign_task = Uuid::new_v4();
    insert_task(
        &fixture.admin,
        foreign_task,
        fixture.stranger,
        fixture.foreign,
        fixture.user,
        "RUNNING",
        "10 minutes",
    )
    .await;

    let (status, body) = call!(
        app,
        get_index_task(token, tenant, &foreign_task.to_string())
    )
    .await;
    assert_failure(&body, status, 404, business::rag::TASK_NOT_FOUND);
    assert_eq!(
        ledger_field(&fixture.admin, &foreign_task.to_string(), "status")
            .await
            .as_deref(),
        Some("RUNNING"),
        "别人的行一个字节都不该被我们改"
    );

    // 本租户、刚起：实例还没被运行时领走，宽限期内不许判死。
    let fresh = Uuid::new_v4();
    insert_task(
        &fixture.admin,
        fresh,
        fixture.tenant,
        fixture.ready,
        fixture.user,
        "RUNNING",
        "0 seconds",
    )
    .await;

    let (status, body) = call!(app, get_index_task(token, tenant, &fresh.to_string())).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "RUNNING", "宽限期内不该判死：{body}");
    assert_eq!(data["progress"], json!(null));

    // 本租户、早就没了：行龄超宽限期，读路径必须把它收敛成失败。
    let stale = Uuid::new_v4();
    insert_task(
        &fixture.admin,
        stale,
        fixture.tenant,
        fixture.archived,
        fixture.user,
        "RUNNING",
        "10 minutes",
    )
    .await;

    let (status, body) = call!(app, get_index_task(token, tenant, &stale.to_string())).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "FAILED", "过了宽限期必须判死：{body}");
    assert_eq!(data["error"], INSTANCE_GONE);
    assert_eq!(
        ledger_field(&fixture.admin, &stale.to_string(), "status")
            .await
            .as_deref(),
        Some("FAILED"),
        "读时修复要落库，不能只改响应"
    );

    // 跨租户资产：起任务同样 404，且不留行。
    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.foreign)),
    )
    .await;
    assert_failure(&body, status, 404, business::rag::ASSET_NOT_FOUND);
    assert_eq!(
        ledger_count(&fixture.admin, fixture.tenant).await,
        "2",
        "只有手工插的两行，坏入参一行都不该留"
    );
}

// ---------------------------------------------------------------------------
// 用例 4：真跑一条索引任务，跨三跳同步观察进度（Gate）
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn runs_an_index_task_to_a_conclusion_and_reports_live_progress() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };

    let uri = test_database_url().expect("已确认设置");
    let store = Store::connect(&settings(&uri, &test_schema()))
        .await
        .expect("连接 durable schema 失败");
    let client = store.client();

    let stub = StubAiWorker::start(
        Script::new(CHUNKS, DIMENSIONS)
            .chunk_set_id(CHUNK_SET)
            // 第一批嵌入按住不放：编排停在「已分块、第一批正在飞」这个稳定状态上，
            // 此时读进度不存在窗口错过的竞争。
            .hang("/embeddings", 1),
    )
    .await;

    let ai_worker = AiWorkerClient::from_parts(&stub.base_url(), INTERNAL_TOKEN, 10_000, false)
        .expect("装配 ai-worker 客户端失败");
    let registered =
        orchestrations::registrations(Arc::new(ai_worker), BATCH, EMBED_MODEL.to_owned());
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

    // 1. 起任务：立刻回一条 RUNNING 的台账记录，不阻塞等结果。
    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.ready)),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(body["msg"], "创建成功");
    assert_eq!(data["status"], "RUNNING");
    assert_eq!(data["progress"], json!(null));
    assert_eq!(data["result"], json!(null));
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["assetID"], fixture.ready.to_string());
    assert_eq!(data["tenantID"], tenant);
    assert_eq!(
        data["userID"]
            .as_str()
            .and_then(|id| Uuid::parse_str(id).ok()),
        Some(fixture.user)
    );

    let task_a = data["id"].as_str().expect("任务 id").to_owned();
    let instance_a = format!("rag-index-{task_a}");
    assert_eq!(
        ledger_field(&fixture.admin, &task_a, "instanceID")
            .await
            .as_deref(),
        Some(instance_a.as_str()),
        "实例名由台账 id 派生——等待者、幂等键、读时修复全靠它对齐"
    );

    // 2. 第一批嵌入按住不放，编排停在「分块已完成」
    stub.wait_for("/embeddings", 1, Duration::from_secs(30))
        .await;
    wait_for_custom_status(&client, &instance_a, "chunked:48").await;

    // 3. 进度必须能**实时**读出来，而不必等任务结束
    let (status, body) = call!(app, get_index_task(token, tenant, &task_a)).await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "RUNNING");
    assert_eq!(data["progress"], "chunked:48");
    assert_eq!(data["result"], json!(null));
    assert_eq!(data["error"], json!(null));

    // 4. 同一资产再来一次：闸门挡下，并把已有任务的 id 一并回给调用方（前端据此跳转）。
    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.ready)),
    )
    .await;
    let msg = assert_failure(&body, status, 409, business::rag::INDEX_ALREADY_RUNNING);
    assert_eq!(msg, "该资产已有索引任务在运行");
    assert_eq!(
        body["details"]["taskID"], task_a,
        "409 要带上正在跑的那条任务 id：{body}"
    );
    assert_eq!(
        ledger_count(&fixture.admin, fixture.tenant).await,
        "1",
        "被闸门挡下的那次不该建行"
    );

    // 5. 放行 → 跑完
    stub.release("/embeddings", 1);

    let data = wait_for_terminal!(app, token, tenant, task_a).await;
    assert_eq!(data["status"], "SUCCEEDED", "任务应当跑完：{data}");
    assert_eq!(data["error"], json!(null));
    assert_eq!(data["progress"], json!(null), "终态不再报过程进度");
    let result = &data["result"];
    assert_eq!(result["assetID"], fixture.ready.to_string());
    assert_eq!(result["chunkSetID"], CHUNK_SET);
    assert_eq!(result["chunkCount"], json!(CHUNKS));
    assert_eq!(result["batches"], json!(3));
    assert_eq!(result["dimensions"], json!(DIMENSIONS));
    assert_eq!(result["indexed"], json!(CHUNKS));
    assert_eq!(result["collection"], COLLECTION);

    // 6. 出站报文形状：跨语言边界的唯一成本控制点，字段漂移必须在这里红
    let chunks = stub.matching("/chunks");
    assert_eq!(chunks.len(), 1, "分块只应当发生一次");
    assert_eq!(chunks[0].method, "POST");
    assert_eq!(chunks[0].internal_token(), INTERNAL_TOKEN);
    assert_eq!(
        chunks[0].path,
        format!("/internal/v1/assets/{}/chunks", fixture.ready)
    );
    assert_eq!(
        chunks[0].json(),
        json!({
            "schemaVersion": INTERNAL_SCHEMA_VERSION,
            "tenantID": tenant,
            "mime": MIME,
            "name": NAME,
        }),
        "分块请求的字段集是契约：对象存储键是 cogito 的实现细节，不该出现在出站请求里"
    );

    let embeds = stub.matching("/embeddings");
    assert_eq!(embeds.len(), 3, "48 块 / 批 16 应当是 3 次嵌入调用");
    let ranges = embeds
        .iter()
        .map(|request| {
            let payload = request.json();
            (payload["from"].as_i64(), payload["to"].as_i64())
        })
        .collect::<Vec<_>>();
    assert_eq!(
        ranges,
        vec![
            (Some(0), Some(16)),
            (Some(16), Some(32)),
            (Some(32), Some(48)),
        ],
        "嵌入区间必须连续且是半开区间"
    );
    assert_eq!(
        embeds[0].json(),
        json!({
            "schemaVersion": INTERNAL_SCHEMA_VERSION,
            "tenantID": tenant,
            "chunkSetID": CHUNK_SET,
            "model": EMBED_MODEL,
            "from": 0,
            "to": BATCH,
        })
    );

    let index = stub.matching("/index");
    assert_eq!(index.len(), 1, "落索引只应当发生一次");
    assert_eq!(
        index[0].json(),
        json!({
            "schemaVersion": INTERNAL_SCHEMA_VERSION,
            "tenantID": tenant,
            "chunkSetID": CHUNK_SET,
            "chunkCount": CHUNKS,
            "model": EMBED_MODEL,
            "dimensions": DIMENSIONS,
        })
    );

    // 7. 幂等键 = 实例 id + 步骤，且**不重不漏**：这条序列就是「重投递不重复干活」的判据
    let keys = stub
        .requests()
        .iter()
        .map(|request| request.idempotency_key())
        .collect::<Vec<_>>();
    assert_eq!(
        keys,
        vec![
            format!("{instance_a}:chunk"),
            format!("{instance_a}:embed:0-16"),
            format!("{instance_a}:embed:16-32"),
            format!("{instance_a}:embed:32-48"),
            format!("{instance_a}:index"),
        ]
    );

    // 8. 五条出站请求各自带一条**互异**的 traceparent（上游没给链路时按步骤派生）
    let traces = stub
        .requests()
        .iter()
        .map(|request| request.traceparent())
        .collect::<Vec<_>>();
    assert_eq!(traces.len(), 5);
    for trace in &traces {
        assert_traceparent(trace);
    }
    for (position, trace) in traces.iter().enumerate() {
        assert!(
            !traces[..position].contains(trace),
            "同一实例的不同步骤不该复用 span-id：{trace}"
        );
    }

    // 9. 终态行不占位：同一资产再起一条是合法操作，且拿到的是**新**任务
    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.ready)),
    )
    .await;
    let data = assert_success(&body, status);
    assert_eq!(data["status"], "RUNNING");
    let task_b = data["id"].as_str().expect("任务 id").to_owned();
    assert_ne!(task_b, task_a, "重跑必须是一条新任务，不能复用台账行");
    assert_eq!(ledger_count(&fixture.admin, fixture.tenant).await, "2");

    runtime.shutdown(5_000).await;
    let _ = store.cleanup_schema().await;
}

// ---------------------------------------------------------------------------
// 用例 5：并发闸门只挡 RUNNING
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn blocks_a_second_task_only_while_one_is_running() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture, None);

    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // 已经有一个在跑的任务：再来一次必须 409，且带出在跑那条的 id。
    let running = Uuid::new_v4();
    insert_task(
        &fixture.admin,
        running,
        fixture.tenant,
        fixture.ready,
        fixture.user,
        "RUNNING",
        "0 seconds",
    )
    .await;

    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.ready)),
    )
    .await;
    let msg = assert_failure(&body, status, 409, business::rag::INDEX_ALREADY_RUNNING);
    assert_eq!(msg, "该资产已有索引任务在运行");
    assert_eq!(
        body["details"]["taskID"],
        running.to_string(),
        "409 必须指出是哪一条在跑：{body}"
    );
    assert_eq!(
        ledger_count(&fixture.admin, fixture.tenant).await,
        "1",
        "被挡下的那次不该建行"
    );

    // 同一个资产上另插一条失败行：失败的任务**不占位**，所以这次不该再被闸门挡。
    let failed = Uuid::new_v4();
    insert_task(
        &fixture.admin,
        failed,
        fixture.tenant,
        fixture.ready,
        fixture.user,
        "FAILED",
        "1 minutes",
    )
    .await;
    // 但 ready 上那条 RUNNING 还在，闸门仍然生效——先把它的资产换掉，单独验「FAILED 不挡」。
    exec(
        &fixture.admin,
        &format!(r#"UPDATE rag_index_task SET status = 'SUCCEEDED' WHERE id = '{running}'"#),
    )
    .await;

    let (status, body) = call!(
        app,
        post_index_task(Some(token), Some(tenant), &payload_for(fixture.ready)),
    )
    .await;
    // 闸门放行了，于是走到起编排那一步——durable 没接通，所以落在 503 上。
    assert_failure(&body, status, 503, business::rag::ORCHESTRATION_UNAVAILABLE);
    assert_eq!(
        ledger_count(&fixture.admin, fixture.tenant).await,
        "3",
        "终态行不占位：这次真的建了行（前两行是手工插的）"
    );
}
