//! 桥的 HTTP 层：两个端点，一层令牌 + 一层会话绑定。
//!
//! `cogito-mcp` 侧约定见 `crates/mcp/src/main.rs`；工具目录与实现都在
//! `cogito_core::tools`，这里只做传输与鉴权。
//!
//! 令牌**不经过渲染进程**（S2）：`start` 把令牌写到 `<appLocalData>/bridge/token`，
//! `bridge:info` 只回文件路径，`cogito-mcp` 自己读。渲染进程被拿下时拿不到「执行任意命令」
//! 的凭据 —— 桥之上挂着 `app_terminal_run` 这类工具。

use std::{
    collections::VecDeque,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use cogito_database::Storage;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

use super::app_tools;
use cogito_core::tools::knowledge as knowledge_tools;
use cogito_core::tools::workspace::UNATTENDED_KEY;

/// 侧车带过来的凭据头（与 `crates/mcp` 的 `BRIDGE_TOKEN_HEADER` 对齐）。
pub const TOKEN_HEADER: &str = "x-bridge-token";
/// 会话绑定头：MCP 每个请求声明自己是替哪个 ACP 会话干活。
pub const SESSION_HEADER: &str = "x-cogito-session";
/// 记住多少个已登记会话（超出后最早的被挤掉）。
const SESSION_LIMIT: usize = 64;

/// 已登记会话集合：`bridge:info` 时由前端带上 `sessionID` 登记。
///
/// 这不是身份认证（令牌仍是唯一凭据），而是**范围收窄**：令牌若因日志/环境变量泄漏，
/// 攻击者还需要一个正在运行的会话标识才能调用工具。集合为空时不校验（首次登记前）。
#[derive(Default)]
pub struct SessionRegistry {
    ids: Mutex<VecDeque<String>>,
}

impl SessionRegistry {
    fn register(&self, id: &str) {
        let id = id.trim();
        if id.is_empty() {
            return;
        }
        let Ok(mut guard) = self.ids.lock() else {
            return;
        };
        if guard.iter().any(|known| known == id) {
            return;
        }
        guard.push_back(id.to_string());
        while guard.len() > SESSION_LIMIT {
            guard.pop_front();
        }
    }

    fn contains(&self, id: &str) -> bool {
        self.ids
            .lock()
            .map(|guard| guard.iter().any(|known| known == id))
            .unwrap_or(false)
    }

    fn is_empty(&self) -> bool {
        self.ids
            .lock()
            .map(|guard| guard.is_empty())
            .unwrap_or(true)
    }
}

/// 桥的对外信息：只给本机侧车用，token 每次启动轮换，且**不再交给渲染进程**。
///
/// 前端只拿到文件路径；真正的令牌由 `cogito-mcp` 自己读文件（见 `bridge::token`）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub url: String,
    /// `<appLocalData>/bridge/token`：MCP 通过 `COGITO_BRIDGE_TOKEN_FILE` 读它
    pub token_file: String,
}

/// 桥的 Tauri state：前端经 `bridge:info` 取 url / tokenFile / mcpPath。
pub struct BridgeState {
    info: BridgeInfo,
    sessions: Arc<SessionRegistry>,
}

impl BridgeState {
    #[must_use]
    pub fn info(&self) -> &BridgeInfo {
        &self.info
    }

    /// 登记一个新会话（`bridge:info` 调用点）。
    pub fn register_session(&self, session_id: &str) {
        self.sessions.register(session_id);
    }
}

#[derive(Clone)]
struct AppState {
    storage: Storage,
    token: Arc<str>,
    /// 浏览器工具需要宿主窗口；单测里没有 app，于是为 `None`
    app: Option<AppHandle>,
    sessions: Arc<SessionRegistry>,
    /// 生产启用会话绑定；单测关掉，避免每条用例都要先登记
    require_session: bool,
}

/// 绑定随机端口并后台运行；返回可直接注入给侧车的 `{url, tokenFile}`。
pub async fn start(storage: Storage, app: AppHandle) -> anyhow::Result<BridgeState> {
    let token = uuid::Uuid::new_v4().to_string();
    // 先落盘再起服务：MCP 可能在桥就绪后的任意时刻被拉起，读不到文件就会退化成「只提供 app_ping」。
    let token_file = super::token::write_token(&app, &token)
        .map_err(|error| anyhow::anyhow!("桥令牌落盘失败: {error}"))?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let address = listener.local_addr()?;
    let sessions = Arc::new(SessionRegistry::default());
    let app = router_with(storage, token, Some(app), sessions.clone(), true);

    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            log::error!("cogito 桥退出: {error}");
        }
    });

    Ok(BridgeState {
        info: BridgeInfo {
            url: format!("http://{address}"),
            token_file: token_file.to_string_lossy().into_owned(),
        },
        sessions,
    })
}

/// 路由装配（仅测试用：生产的 `start` 会带上 AppHandle 走 `router_with`）。
#[cfg(test)]
pub fn router(storage: Storage, token: String) -> Router {
    router_with(
        storage,
        token,
        None,
        Arc::new(SessionRegistry::default()),
        false,
    )
}

/// 带会话绑定的测试路由：验证「缺会话 / 未登记会话」被拒。
#[cfg(test)]
fn router_with_session(storage: Storage, token: String, sessions: Arc<SessionRegistry>) -> Router {
    router_with(storage, token, None, sessions, true)
}

fn router_with(
    storage: Storage,
    token: String,
    app: Option<AppHandle>,
    sessions: Arc<SessionRegistry>,
    require_session: bool,
) -> Router {
    Router::new()
        .route("/internal/tools/list", get(list_tools))
        .route("/internal/tools/call", post(call_tool))
        .with_state(AppState {
            storage,
            token: Arc::from(token),
            app,
            sessions,
            require_session,
        })
}

fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), &'static str> {
    // Host 必须是回环地址：防止 DNS rebinding 把本机桥暴露给网页。
    if let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    {
        let hostname = host.rsplit_once(':').map_or(host, |(name, _)| name);
        if hostname != "127.0.0.1" && hostname != "localhost" {
            return Err("Host 不是本机地址");
        }
    }

    let token = headers
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !super::token::token_matches(state.token.as_ref(), token) {
        return Err("token 无效");
    }

    // 会话绑定：缺会话一律拒；已登记过会话后，未登记的会话也拒。
    if state.require_session {
        let session = headers
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .trim();
        if session.is_empty() {
            return Err("缺少会话标识");
        }
        if !state.sessions.is_empty() && !state.sessions.contains(session) {
            return Err("会话未登记");
        }
    }

    Ok(())
}

fn reject(reason: &str) -> Response {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": reason }))).into_response()
}

/// app 侧执行的工具（浏览器 / 终端）同样落审计（S6）：它们才是权限最大的一批，
/// 走 `app_tools::call` 绕过了 `cogito_core::tools::call` 的审计点。
async fn audit_call(
    state: &AppState,
    tool: &str,
    ok: bool,
    error: Option<&str>,
    arguments: &Value,
    duration_ms: i64,
) {
    if let Err(failure) = cogito_core::tools::audit::record(
        state.storage.connection(),
        tool,
        ok,
        error,
        arguments,
        duration_ms,
    )
    .await
    {
        tracing::warn!("工具审计写入失败（{tool}）：{failure}");
    }
}

/// 被拒请求也要留痕（S6）：401 的调用压根到不了 `tools::call`，不在这里记就
/// 彻底没有痕迹。写库失败只 warn —— 拒绝原因本身必须原样返回给侧车。
async fn audit_reject(state: &AppState, tool: &str, reason: &str, arguments: &Value) {
    if let Err(error) = cogito_core::tools::audit::record_rejected(
        state.storage.connection(),
        tool,
        reason,
        arguments,
    )
    .await
    {
        tracing::warn!("工具审计写入失败（拒绝 {tool}）：{error}");
    }
}

async fn list_tools(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(reason) = authorize(&state, &headers) {
        audit_reject(&state, "tools/list", reason, &Value::Null).await;
        return reject(reason);
    }
    Json(json!({ "tools": cogito_core::tools::catalog() })).into_response()
}

#[derive(Debug, Deserialize)]
struct CallBody {
    name: String,
    #[serde(default)]
    arguments: Value,
}

/// 桥的会话头（`x-cogito-session`）：缺失 / 空串都视为「没有会话」
fn find_session(headers: &HeaderMap) -> Option<String> {
    headers
        .get(SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// 这个会话是否在目标推进（无人值守）：`agent_goal` 里那一行还是 `running`。
///
/// 用库而不是内存标志：目标状态本来就落库（刷新 / 重启后都要能续跑），
/// 桥里再维护一份就是第二个真相源。读不到按「需要确认」处理 —— 宁可多问一次。
async fn is_goal_running(state: &AppState, session_id: &str) -> bool {
    use cogito_database::entity::agent_goal as goal;
    let params = goal::ReadP::One(goal::Read {
        id: None,
        sessionID: Some(session_id.to_string()),
        status: Some("running".to_string()),
    });
    match cogito_core::agent_goal::Service::toRead(state.storage.connection(), params).await {
        Ok(rows) => !rows.is_empty(),
        Err(error) => {
            log::warn!("读 agent_goal 失败，按需要确认处理: {error}");
            false
        }
    }
}

async fn call_tool(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CallBody>,
) -> Response {    if let Err(reason) = authorize(&state, &headers) {
        audit_reject(&state, &body.name, reason, &body.arguments).await;
        return reject(reason);
    }
    // 浏览器 / 终端 / 子 agent 工具只能由 app 执行（要拿 webview / PTY / 渲染进程），
    // 先在这里拦下来
    if app_tools::owns(&body.name) {
        let Some(app) = &state.app else {
            audit_call(
                &state,
                &body.name,
                false,
                Some("浏览器工具需要宿主窗口"),
                &body.arguments,
                0,
            )
            .await;
            return Json(json!({ "ok": false, "error": "浏览器工具需要宿主窗口" })).into_response();
        };
        // 这条分支绕过 `tools::call`（工具实现在 app 侧），审计得在这里补一次
        let session = find_session(&headers);
        let started = std::time::Instant::now();
        let outcome = app_tools::call(app, &body.name, &body.arguments, session.as_deref()).await;
        let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
        return match outcome {
            Some(Ok(value)) => {
                audit_call(&state, &body.name, true, None, &body.arguments, duration_ms).await;
                Json(json!({ "ok": true, "value": value })).into_response()
            }
            Some(Err(error)) => {
                audit_call(
                    &state,
                    &body.name,
                    false,
                    Some(&error),
                    &body.arguments,
                    duration_ms,
                )
                .await;
                Json(json!({ "ok": false, "error": error })).into_response()
            }
            None => {
                let error = format!("未实现的工具：{}", body.name);
                audit_call(
                    &state,
                    &body.name,
                    false,
                    Some(&error),
                    &body.arguments,
                    duration_ms,
                )
                .await;
                Json(json!({ "ok": false, "error": error })).into_response()
            }
        };
    }
    // 工具级失败走 200 + `ok:false`：让模型看到原因，而不是协议错误。
    //
    // 目标推进（无人值守）是**桥侧事实**：`agent_goal.status = running` 时注入
    // 「受保护文件可写」标记，模型传的同名参数一律被覆盖（伪造无效）。
    // 审计仍用模型原始参数（`body.arguments`），不把注入项当成模型输入。
    let mut arguments = body.arguments.clone();
    if let Some(session) = find_session(&headers) {
        if is_goal_running(&state, &session).await {
            if let Value::Object(map) = &mut arguments {
                map.insert(UNATTENDED_KEY.to_string(), Value::Bool(true));
            }
        }
    }
    match cogito_core::tools::call(state.storage.connection(), &body.name, &arguments).await {
        Ok(value) => {
            // ingest 只校验入队；真正 ACP 两阶段由前端队列执行
            if body.name == knowledge_tools::INGEST
                && value.get("queued").and_then(Value::as_bool) == Some(true)
            {
                if let Some(app) = &state.app {
                    if let Err(error) = app.emit("knowledge://enqueue-ingest", &value) {
                        tracing::warn!("emit knowledge://enqueue-ingest failed: {error}");
                    }
                }
            }
            Json(json!({ "ok": true, "value": value })).into_response()
        }
        Err(error) => Json(json!({ "ok": false, "error": error })).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::*;

    async fn test_storage() -> Storage {
        let connection = cogito_database::initialize("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");
        cogito_database::migration::run(&connection)
            .await
            .expect("migration should succeed");
        Storage::new(connection)
    }

    fn request(path: &str, token: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().uri(path);
        if let Some(token) = token {
            builder = builder.header(TOKEN_HEADER, token);
        }
        builder.body(Body::empty()).expect("request")
    }

    fn request_with_session(path: &str, token: &str, session: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().uri(path).header(TOKEN_HEADER, token);
        if let Some(session) = session {
            builder = builder.header(SESSION_HEADER, session);
        }
        builder.body(Body::empty()).expect("request")
    }

    #[tokio::test]
    async fn rejects_missing_token() {
        let app = router(test_storage().await, "secret".to_string());
        let response = app
            .oneshot(request("/internal/tools/list", None))
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    /// 被拒的调用同样留痕（S6）：401 到不了 `tools::call`，只能由桥自己记。
    #[tokio::test]
    async fn rejected_call_is_audited() {
        let storage = test_storage().await;
        let app = router(storage.clone(), "secret".to_string());
        let body = serde_json::to_vec(&json!({
            "name": "app_workspace_write",
            "arguments": { "path": "a.txt", "content": "机密" }
        }))
        .expect("json");
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/internal/tools/call")
                    .header(TOKEN_HEADER, "wrong")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let rows = cogito_core::tools::audit::recent(storage.connection(), 10)
            .await
            .expect("读审计");
        assert_eq!(rows.len(), 1, "被拒请求要落一行");
        assert_eq!(rows[0].tool_name, "app_workspace_write");
        assert!(!rows[0].ok);
        assert_eq!(rows[0].error.as_deref(), Some("token 无效"));
        // effect/risk 仍按工具目录标，方便按风险面筛查被拒的写操作
        assert_eq!(rows[0].effect, "write");
        assert_eq!(rows[0].risk, "guarded");
    }

    #[tokio::test]
    async fn lists_tools_with_effect_and_risk() {
        let app = router(test_storage().await, "secret".to_string());
        let response = app
            .oneshot(request("/internal/tools/list", Some("secret")))
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let body: Value = serde_json::from_slice(&bytes).expect("json");
        let names: Vec<&str> = body["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert!(names.contains(&"app_calendar_read"));
        assert!(names.contains(&"app_workspace_list"));
        // S3：Agent 的文件写入口也走同一份目录，且带内部 risk 字段
        assert!(names.contains(&"app_workspace_write"));
        assert!(names.contains(&"app_workspace_patch"));
        let guarded = body["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .find(|tool| tool["name"] == json!("app_workspace_write"))
            .expect("app_workspace_write 必须在目录里");
        assert_eq!(guarded["effect"], json!("write"));
        assert_eq!(guarded["risk"], json!("guarded"));
    }

    #[tokio::test]
    async fn calls_calendar_read_against_empty_db() {
        let app = router(test_storage().await, "secret".to_string());
        let body = serde_json::to_vec(&json!({
            "name": "app_calendar_read",
            "arguments": { "from": 0, "to": 1 }
        }))
        .expect("json");
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/internal/tools/call")
                    .header(TOKEN_HEADER, "secret")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let body: Value = serde_json::from_slice(&bytes).expect("json");
        assert_eq!(body["ok"], Value::Bool(true), "{body}");
        assert_eq!(body["value"], json!([]));
    }

    #[tokio::test]
    async fn rejects_missing_session_when_binding_is_on() {
        let sessions = Arc::new(SessionRegistry::default());
        let app = router_with_session(test_storage().await, "secret".to_string(), sessions);
        let response = app
            .oneshot(request_with_session("/internal/tools/list", "secret", None))
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_unregistered_session() {
        let sessions = Arc::new(SessionRegistry::default());
        sessions.register("goose-acp:aaaa");
        let app = router_with_session(test_storage().await, "secret".to_string(), sessions);
        let response = app
            .oneshot(request_with_session(
                "/internal/tools/list",
                "secret",
                Some("goose-acp:bbbb"),
            ))
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn accepts_registered_session() {
        let sessions = Arc::new(SessionRegistry::default());
        sessions.register("goose-acp:aaaa");
        let app = router_with_session(test_storage().await, "secret".to_string(), sessions);
        let response = app
            .oneshot(request_with_session(
                "/internal/tools/list",
                "secret",
                Some("goose-acp:aaaa"),
            ))
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn session_registry_keeps_only_recent_entries() {
        let sessions = SessionRegistry::default();
        for index in 0..(SESSION_LIMIT + 5) {
            sessions.register(&format!("goose-acp:{index}"));
        }
        assert!(!sessions.contains("goose-acp:0"), "最早的会话应被挤掉");
        assert!(sessions.contains(&format!("goose-acp:{SESSION_LIMIT}")));
    }
}
