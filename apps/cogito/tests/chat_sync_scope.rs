//! 会话同步的用户面端到端：真 HTTP 链路 → 真库 RLS → 真 Redis → 真 JWT。
//!
//! 水位与冲突规则的单测在 `crates/chat`（纯函数）；这里守的是它们**接上真库之后**还成不成立：
//!
//! 1. 推一批 → 按水位拉回来，会话 / 消息 / 用量与墓碑都能复现（含 `hasMore` 的边界）；
//! 2. 重发同一批是无操作：水位与行数都不变（客户端网络重试必须安全）；
//! 3. 冲突只报不改：过期的基线改不动服务端更新的那份，但同一批里其余的行照常落库；
//! 4. 删除是墓碑：随增量下发，且之后一次改名不会把会话改活；
//! 5. 引用不存在会话的消息被整体拒绝，**一行脏数据都不留**（事务回滚）；
//! 6. 跨租户：别人的水位与数据既看不见也拉不到，别人的成员拿我们的租户头是 403。
//!
//! 需要 `TEST_DATABASE_URL`（`Migrator::fresh` 会**重建整个库**）与 `TEST_REDIS_URL`，
//! 且必须串行跑（`--test-threads=1`）——两条都缺就直接跳过。

mod support;

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use actix_web::test;
use cogito::bootstrap::BootstrapOptions;
use cogito::clients::redis::RedisPool;
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::middlewares::rate_limit::AuthGovernor;
use cogito::oas::paths::CHAT_SYNC;
use cogito::utils::code::{self, auth, business, request as request_codes};
use cogito::utils::jwt::generate_token;
use identity::PlatformRole;
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, Statement,
};
use serde_json::{Value, json};
use support::test_database_url;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 应用角色：`Migrator::fresh` 用超级用户建表，业务连接必须换成一个**非超级用户**，
/// 否则 `FORCE ROW LEVEL SECURITY` 会被静默绕过，跨租户的断言全部变成假绿。
const APP_ROLE: &str = "cogito_app_test";

/// `Migrator::fresh` 会重建整个库，用例之间只能串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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
    token: String,
    /// `stranger` 成员的 JWT：拿它配我们的租户头，必须 403；配它自己的租户头则是合法调用。
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

/// 库里某租户的某个计数。用超级用户连接查，绕开 RLS——断言的是「库里到底有几行」。
async fn count_of(db: &DatabaseConnection, table: &str, tenant: Uuid) -> i64 {
    scalar(
        db,
        &format!(r#"SELECT count(*)::text FROM {table} WHERE "tenantID" = '{tenant}'"#),
    )
    .await
    .and_then(|value| value.parse().ok())
    .unwrap_or_else(|| panic!("{table} 的 count 应当有结果"))
}

/// 某会话的某一列文本值（NULL 与空串都算「没有」）。
async fn session_field(db: &DatabaseConnection, id: &str, column: &str) -> Option<String> {
    scalar(
        db,
        &format!(r#"SELECT COALESCE("{column}"::text, '') FROM chat_session WHERE id = '{id}'"#),
    )
    .await
    .filter(|value| !value.is_empty())
}

async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let redis_url = test_redis_url()?;

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

    let config = Configure::default();
    let secret = config.security.jwt_secret.clone();

    let tenant = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let user = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let suffix = &Uuid::new_v4().simple().to_string()[..8];

    for (id, tag) in [
        (tenant, format!("chat-{suffix}-a")),
        (stranger, format!("chat-{suffix}-b")),
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
        (user, format!("chat-{suffix}-u")),
        (outsider, format!("chat-{suffix}-o")),
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

    let token = generate_token(&user.to_string(), "chat-user", PlatformRole::User, &secret, None)
        .expect("签发令牌失败");
    let outsider_token = generate_token(
        &outsider.to_string(),
        "chat-outsider",
        PlatformRole::User,
        &secret,
        None,
    )
    .expect("签发令牌失败");

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
        admin,
        tenant,
        stranger,
        token,
        outsider_token,
    })
}

// ---------------------------------------------------------------------------
// 请求构造与断言辅助
// ---------------------------------------------------------------------------

macro_rules! build_app {
    ($fixture:expr $(,)?) => {{
        // 类型显式写出来：`bootstrap_app!` 收的是 `Option<Arc<durable::Client>>`，
        // 直接传 `None` 推不出类型。本域不用编排，所以是空的那个。
        let durable: Option<Arc<durable::Client>> = None;
        let ai_worker: Option<Arc<cogito::clients::ai_worker::AiWorkerClient>> = None;
        test::init_service(cogito::bootstrap_app!(
            Arc::clone(&$fixture.storage),
            Arc::clone(&$fixture.config),
            Arc::clone(&$fixture.redis),
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

fn push_request(token: Option<&str>, tenant: Option<&str>, payload: &Value) -> test::TestRequest {
    let mut request = test::TestRequest::post().uri(CHAT_SYNC);
    if let Some(token) = token {
        request = request.insert_header(("Authorization", format!("Bearer {token}")));
    }
    if let Some(tenant) = tenant {
        request = request.insert_header(("X-Tenant-ID", tenant.to_owned()));
    }
    request.set_json(payload)
}

fn pull_request(token: &str, tenant: &str, since: i64, limit: Option<u64>) -> test::TestRequest {
    let uri = match limit {
        Some(limit) => format!("{CHAT_SYNC}?since={since}&limit={limit}"),
        None => format!("{CHAT_SYNC}?since={since}"),
    };
    test::TestRequest::get()
        .uri(&uri)
        .insert_header(("Authorization", format!("Bearer {token}")))
        .insert_header(("X-Tenant-ID", tenant.to_owned()))
}

/// 断言成功响应的信封与业务码。
fn assert_success(body: &Value, status: u16) -> &Value {
    assert_eq!(status, 200, "HTTP 状态不符：{body}");
    assert_eq!(body["success"], json!(true), "响应必须 success=true：{body}");
    assert_eq!(body["code"].as_i64(), Some(code::SUCCESS as i64), "业务码不符：{body}");
    &body["data"]
}

/// 断言失败响应的状态码与错误码。
fn assert_failure(body: &Value, status: u16, want_status: u16, want_code: i32) {
    assert_eq!(status, want_status, "HTTP 状态不符：{body}");
    assert_eq!(
        body["success"],
        json!(false),
        "失败响应必须 success=false：{body}"
    );
    assert_eq!(body["code"].as_i64(), Some(want_code as i64), "错误码不符：{body}");
}

fn session_payload(id: Uuid, title: &str) -> Value {
    json!({
        "id": id.to_string(),
        "title": title,
        "pinned": false,
        "workspaceID": null,
        "clientUpdatedAt": 1_700_000_000_000i64,
        "archivedAt": null,
    })
}

/// 一次推送的载荷（会话 + 一条消息 + 一笔用量），批次标识由调用方给。
fn batch_payload(client_batch_id: &str, base_revision: i64, session: Uuid, title: &str) -> Value {
    json!({
        "clientBatchID": client_batch_id,
        "baseRevision": base_revision,
        "upserts": {
            "sessions": [session_payload(session, title)],
            "messages": [{
                "id": Uuid::new_v4().to_string(),
                "sessionID": session.to_string(),
                "parentID": null,
                "format": "ith/thread-message-like",
                "content": "{\"role\":\"user\"}",
                "clientCreatedAt": 1_700_000_000_001i64,
            }],
            "usages": [{
                "id": Uuid::new_v4().to_string(),
                "runID": format!("run-{client_batch_id}"),
                "sessionID": session.to_string(),
                "providerID": "cogito_gateway",
                "model": "deepseek-chat",
                "source": "gateway",
                "outcome": "SUCCEEDED",
                "inputTokens": 100,
                "outputTokens": 20,
                "totalTokens": 120,
                "clientCreatedAt": 1_700_000_000_002i64,
            }],
        },
        "deletes": { "sessionIDs": [], "messageIDs": [] },
    })
}

// ---------------------------------------------------------------------------
// 用例 1：推一批 → 按水位拉回来
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn pushed_batch_comes_back_through_the_increment_window() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);
    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // 空库：水位 0，没有批次，也就没有更多。
    let (status, body) = call!(app, pull_request(token, tenant, 0, None)).await;
    let data = assert_success(&body, status).clone();
    assert_eq!(data["revision"], json!(0));
    assert_eq!(data["hasMore"], json!(false));
    assert_eq!(data["items"], json!([]));

    let session = Uuid::new_v4();
    let payload = batch_payload("batch-1", 0, session, "第一次同步");
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(1), "第一批占水位 1：{pushed}");
    assert_eq!(pushed["applied"], json!(3), "会话 + 消息 + 用量：{pushed}");
    assert_eq!(pushed["conflicts"], json!([]));

    // 从 0 拉：整批一次交付，三者都在。
    let (status, body) = call!(app, pull_request(token, tenant, 0, None)).await;
    let data = assert_success(&body, status).clone();
    assert_eq!(data["revision"], json!(1), "游标停在交付到的水位：{data}");
    assert_eq!(data["hasMore"], json!(false));
    let items = data["items"].as_array().expect("items 应当是数组");
    assert_eq!(items.len(), 1, "一批一个水位：{data}");
    assert_eq!(items[0]["revision"], json!(1));
    assert_eq!(items[0]["sessions"][0]["id"], json!(session.to_string()));
    assert_eq!(items[0]["sessions"][0]["title"], json!("第一次同步"));
    assert_eq!(items[0]["messages"].as_array().map(Vec::len), Some(1));
    assert_eq!(items[0]["usages"].as_array().map(Vec::len), Some(1));
    assert_eq!(items[0]["usages"][0]["totalTokens"], json!(120));
    assert_eq!(items[0]["deletedSessionIDs"], json!([]));

    // 游标推到头之后就是空窗口：`revision` 原样返回，客户端不会打转。
    let (status, body) = call!(app, pull_request(token, tenant, 1, None)).await;
    let data = assert_success(&body, status).clone();
    assert_eq!(data["revision"], json!(1));
    assert_eq!(data["items"], json!([]));
}

// ---------------------------------------------------------------------------
// 用例 2：重发同一批是无操作
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn replaying_a_batch_changes_nothing() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);
    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let session = Uuid::new_v4();
    let payload = batch_payload("batch-replay", 0, session, "重发");
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    let first = assert_success(&body, status).clone();

    // 同一批原样再发一次：水位与写入行数都回放，不新建第二批。
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    let second = assert_success(&body, status).clone();
    assert_eq!(second["revision"], first["revision"], "重发不得推高水位");
    assert_eq!(second["applied"], first["applied"], "重发回放写入行数");

    assert_eq!(count_of(&fixture.admin, "chat_sync_batch", fixture.tenant).await, 1);
    assert_eq!(count_of(&fixture.admin, "chat_session", fixture.tenant).await, 1);
    assert_eq!(count_of(&fixture.admin, "chat_message", fixture.tenant).await, 1);
    assert_eq!(count_of(&fixture.admin, "chat_usage", fixture.tenant).await, 1);

    // 拉取端也就只看到一批：重发不该变成一条假变更。
    let (status, body) = call!(app, pull_request(token, tenant, 0, None)).await;
    let data = assert_success(&body, status).clone();
    assert_eq!(data["items"].as_array().map(Vec::len), Some(1));
}

// ---------------------------------------------------------------------------
// 用例 3：冲突只报不改，同一批其余的行照常落
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn stale_edits_are_reported_as_conflicts_without_blocking_the_batch() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);
    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let session = Uuid::new_v4();
    let payload = batch_payload("batch-1", 0, session, "v1");
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    assert_success(&body, status);

    // 同一台设备改名（基线正确）：水位 2。
    let payload = batch_payload("batch-2", 1, session, "v2");
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(2));
    assert_eq!(pushed["conflicts"], json!([]));

    // 另一台设备拿着**旧基线**（0）来改名，同时带一条全新会话。
    let fresh = Uuid::new_v4();
    let stale = json!({
        "clientBatchID": "batch-3",
        "baseRevision": 0,
        "upserts": {
            "sessions": [session_payload(session, "v3"), session_payload(fresh, "新会话")],
            "messages": [],
            "usages": [],
        },
        "deletes": { "sessionIDs": [], "messageIDs": [] },
    });
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &stale)).await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(3));
    assert_eq!(pushed["applied"], json!(1), "只有新会话落了库：{pushed}");

    let conflicts = pushed["conflicts"].as_array().expect("conflicts 应当是数组");
    assert_eq!(conflicts.len(), 1, "只有那一行改名撞车：{pushed}");
    assert_eq!(conflicts[0]["id"], json!(session.to_string()));
    assert_eq!(conflicts[0]["title"], json!("v2"), "服务端那份要原样给客户端");
    assert_eq!(conflicts[0]["revision"], json!(2));

    // 服务端那份没被覆盖，冲突行也没占新水位。
    let stored = session_field(&fixture.admin, &session.to_string(), "title").await;
    assert_eq!(stored.as_deref(), Some("v2"), "冲突行不该被写");
    let revision = session_field(&fixture.admin, &session.to_string(), "revision").await;
    assert_eq!(revision.as_deref(), Some("2"));
}

// ---------------------------------------------------------------------------
// 用例 4：删除是墓碑，且不可复活
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn deletion_travels_as_a_tombstone_and_is_never_undone() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);
    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let session = Uuid::new_v4();
    let payload = batch_payload("batch-1", 0, session, "要删的会话");
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    assert_success(&body, status);

    let delete = json!({
        "clientBatchID": "batch-2",
        "baseRevision": 1,
        "upserts": { "sessions": [], "messages": [], "usages": [] },
        "deletes": { "sessionIDs": [session.to_string()], "messageIDs": [] },
    });
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &delete)).await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(2));
    assert_eq!(pushed["applied"], json!(1));

    // 墓碑随增量下发；行还在库里（软删），否则别的设备就拉不到「它被删了」。
    let (status, body) = call!(app, pull_request(token, tenant, 1, None)).await;
    let data = assert_success(&body, status).clone();
    let items = data["items"].as_array().expect("items 应当是数组");
    assert_eq!(items.len(), 1, "删除也要占水位，否则别的设备永远看不到这次删除：{data}");
    assert_eq!(items[0]["sessions"], json!([]), "墓碑不进 sessions");
    assert_eq!(
        items[0]["deletedSessionIDs"],
        json!([session.to_string()])
    );
    assert_eq!(count_of(&fixture.admin, "chat_session", fixture.tenant).await, 1);

    // 拿删除之前的基线来改名：墓碑优先，不回改活，但要把「已经删了」告诉客户端。
    let resurrect = json!({
        "clientBatchID": "batch-3",
        "baseRevision": 1,
        "upserts": { "sessions": [session_payload(session, "改个名")], "messages": [], "usages": [] },
        "deletes": { "sessionIDs": [], "messageIDs": [] },
    });
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &resurrect)).await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["applied"], json!(0), "一行都不该落：{pushed}");
    let conflicts = pushed["conflicts"].as_array().expect("conflicts 应当是数组");
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0]["title"], json!("要删的会话"), "服务端那份没变");
    assert!(
        conflicts[0]["archivedAt"].as_i64().is_some(),
        "要带出墓碑，客户端才知道该删本地行：{pushed}"
    );

    let title = session_field(&fixture.admin, &session.to_string(), "title").await;
    assert_eq!(title.as_deref(), Some("要删的会话"), "墓碑行不该被改名");
}

// ---------------------------------------------------------------------------
// 用例 5：引用不存在会话的消息被整体拒绝，不留脏数据
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn a_message_without_its_session_leaves_nothing_behind() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);
    let tenant = fixture.tenant.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    let known = Uuid::new_v4();
    let unknown = Uuid::new_v4();
    let payload = json!({
        "clientBatchID": "batch-orphan",
        "baseRevision": 0,
        "upserts": {
            // 会话在，但消息指向另一个不存在的会话：整批必须回滚。
            "sessions": [session_payload(known, "有会话")],
            "messages": [{
                "id": Uuid::new_v4().to_string(),
                "sessionID": unknown.to_string(),
                "parentID": null,
                "format": "ith/thread-message-like",
                "content": "{}",
                "clientCreatedAt": 1_700_000_000_000i64,
            }],
            "usages": [],
        },
        "deletes": { "sessionIDs": [], "messageIDs": [] },
    });

    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &payload)).await;
    assert_failure(&body, status, 422, business::chat::SESSION_MISSING);

    // 事务回滚：会话、批次台账都不该留下半个影子。
    assert_eq!(count_of(&fixture.admin, "chat_session", fixture.tenant).await, 0);
    assert_eq!(count_of(&fixture.admin, "chat_sync_batch", fixture.tenant).await, 0);
    assert_eq!(count_of(&fixture.admin, "chat_message", fixture.tenant).await, 0);

    // 修好次序之后同一批能过（水位从头开始，不受那次失败影响）。
    let fixed = json!({
        "clientBatchID": "batch-orphan",
        "baseRevision": 0,
        "upserts": {
            "sessions": [session_payload(known, "有会话")],
            "messages": [],
            "usages": [],
        },
        "deletes": { "sessionIDs": [], "messageIDs": [] },
    });
    let (status, body) = call!(app, push_request(Some(token), Some(tenant), &fixed)).await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(1), "失败的批次不该占用水位：{pushed}");
}

// ---------------------------------------------------------------------------
// 用例 6：跨租户与鉴权
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn tenants_cannot_see_each_others_streams() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        return;
    };
    let app = build_app!(fixture);
    let tenant = fixture.tenant.to_string();
    let stranger = fixture.stranger.to_string();
    let (tenant, token) = (tenant.as_str(), fixture.token.as_str());

    // 无令牌：鉴权发生在任何业务判断之前（连租户头都不看）。
    let anonymous = test::TestRequest::get()
        .uri(&format!("{CHAT_SYNC}?since=0"))
        .insert_header(("X-Tenant-ID", tenant.to_owned()));
    let (status, body) = call!(app, anonymous).await;
    assert_failure(&body, status, 401, auth::NOT_LOGGED_IN);

    let (status, body) = call!(
        app,
        push_request(Some(token), None, &batch_payload("batch-1", 0, Uuid::new_v4(), "x"))
    )
    .await;
    assert_failure(&body, status, 400, request_codes::MISSING_PARAMETER);

    let (status, body) = call!(
        app,
        push_request(
            Some(token),
            Some("not-a-uuid"),
            &batch_payload("batch-1", 0, Uuid::new_v4(), "x")
        )
    )
    .await;
    assert_failure(&body, status, 400, request_codes::INVALID_HEADER);

    // 别人的成员拿我们的租户头：403（不是 404——租户头是调用方自己写的值）。
    let (status, body) = call!(
        app,
        push_request(
            Some(fixture.outsider_token.as_str()),
            Some(tenant),
            &batch_payload("batch-1", 0, Uuid::new_v4(), "x")
        )
    )
    .await;
    assert_failure(&body, status, 403, auth::ACCESS_DENIED);

    // 陌生人推自己租户的一批（合法调用）：水位 1。
    let their_session = Uuid::new_v4();
    let (status, body) = call!(
        app,
        push_request(
            Some(fixture.outsider_token.as_str()),
            Some(stranger.as_str()),
            &batch_payload("their-batch", 0, their_session, "他们自己的会话")
        )
    )
    .await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(1), "水位是按租户分的：{pushed}");

    // 我们拉自己的流：只有我们自己那一批，别人的会话一个字都看不到。
    let ours = Uuid::new_v4();
    let (status, body) = call!(
        app,
        push_request(
            Some(token),
            Some(tenant),
            &batch_payload("our-batch", 0, ours, "我们的会话")
        )
    )
    .await;
    let pushed = assert_success(&body, status).clone();
    assert_eq!(pushed["revision"], json!(1), "每个租户各自从 1 开始：{pushed}");

    let (status, body) = call!(app, pull_request(token, tenant, 0, None)).await;
    let data = assert_success(&body, status).clone();
    let rendered = data.to_string();
    assert!(rendered.contains(&ours.to_string()), "应当看到自己的会话：{data}");
    assert!(
        !rendered.contains(&their_session.to_string()),
        "不该看到别的租户的会话：{data}"
    );
}
