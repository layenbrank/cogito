//! 本机 Wiki HTTP：默认 `127.0.0.1:19828`（隔离 dev 实例 19829，见 `utils::instance`）；`allowLanAccess` 时绑 `0.0.0.0:<port>`
//! - `POST /clip` — MV3 剪藏
//! - `GET /health` — Clip 守护状态
//! - `GET|POST /api/v1/*` — 内置 Wiki API（health / bases / search）

use std::{
    net::Ipv4Addr,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use cogito_core::knowledge::Service;
use cogito_database::Storage;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub use crate::utils::instance::clip_port;

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPayload {
    pub title: String,
    pub url: String,
    pub markdown: String,
}

#[derive(Clone)]
pub(crate) struct WikiHttpState {
    pub(crate) app: AppHandle,
    pub(crate) storage: Storage,
    pub(crate) api_enabled: Arc<AtomicBool>,
    pub(crate) allow_unauthenticated: Arc<AtomicBool>,
    pub(crate) allow_lan_access: Arc<AtomicBool>,
    pub(crate) mcp_enabled: Arc<AtomicBool>,
    /// agent 代理开关：默认关闭，必须在设置页显式打开（见 `bridge/agent.rs` 的注释）
    pub(crate) agent_enabled: Arc<AtomicBool>,
    pub(crate) api_token: Arc<Mutex<String>>,
    pub(crate) last_clip_at: Arc<AtomicU64>,
    pub(crate) clip_count: Arc<AtomicU64>,
}

impl WikiHttpState {
    /// 请求里带的令牌：`Authorization: Bearer` 或 `x-api-token`。
    ///
    /// 两种都支持是因为调用方不同：`cogito-mcp` 用 header，浏览器扩展用 Bearer 更顺手。
    pub(crate) fn read_presented_token(headers: &HeaderMap) -> String {
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or("");
        if !bearer.is_empty() {
            return bearer.to_string();
        }
        headers
            .get("x-api-token")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string()
    }

    /// agent 面的鉴权：**永远需要已配置的令牌**，没有「未配置就放行」的退路。
    ///
    /// 与 [`authorize`] 的差别就在这里：那个是给只读 Wiki API 用的，允许
    /// `allow_unauthenticated`；agent 面能写文件、能跑命令，那套空子不能开。
    pub(crate) fn is_agent_authorized(&self, headers: &HeaderMap) -> bool {
        let expected = self
            .api_token
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        match_agent_token(&expected, headers)
    }
}

/// agent 面的令牌判定（纯函数，便于单测）。
///
/// 关键一条：**期望值为空时一律拒绝**。如果这里跟着 [`authorize`] 写成「空就放行」，
/// 那么「装完客户端就有一个能改文件、能跑命令的无鉴权入口」就会静默成立。
fn match_agent_token(expected: &str, headers: &HeaderMap) -> bool {
    if expected.trim().is_empty() {
        return false;
    }
    let presented = WikiHttpState::read_presented_token(headers);
    !presented.is_empty() && presented == expected
}

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

struct WikiHttpConfigHandles {
    api_enabled: Arc<AtomicBool>,
    allow_unauthenticated: Arc<AtomicBool>,
    allow_lan_access: Arc<AtomicBool>,
    mcp_enabled: Arc<AtomicBool>,
    agent_enabled: Arc<AtomicBool>,
    api_token: Arc<Mutex<String>>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    boot: Mutex<Option<(AppHandle, Storage)>>,
    last_clip_at: Arc<AtomicU64>,
    clip_count: Arc<AtomicU64>,
}

static CONFIG_HANDLES: OnceLock<WikiHttpConfigHandles> = OnceLock::new();

fn config_handles() -> &'static WikiHttpConfigHandles {
    CONFIG_HANDLES.get_or_init(|| WikiHttpConfigHandles {
        api_enabled: Arc::new(AtomicBool::new(true)),
        allow_unauthenticated: Arc::new(AtomicBool::new(true)),
        allow_lan_access: Arc::new(AtomicBool::new(false)),
        mcp_enabled: Arc::new(AtomicBool::new(true)),
        agent_enabled: Arc::new(AtomicBool::new(false)),
        api_token: Arc::new(Mutex::new(String::new())),
        shutdown_tx: Mutex::new(None),
        boot: Mutex::new(None),
        last_clip_at: Arc::new(AtomicU64::new(0)),
        clip_count: Arc::new(AtomicU64::new(0)),
    })
}

fn bind_host() -> Ipv4Addr {
    if config_handles().allow_lan_access.load(Ordering::Relaxed) {
        Ipv4Addr::UNSPECIFIED
    } else {
        Ipv4Addr::LOCALHOST
    }
}

async fn bind_and_serve(app: AppHandle, storage: Storage) {
    let host = bind_host();
    let port = clip_port();
    let listener = match TcpListener::bind((host, port)).await {
        Ok(listener) => listener,
        Err(error) => {
            log::warn!("知识剪藏/API 端口 {port} 绑定 {host} 失败: {error}");
            SERVER_RUNNING.store(false, Ordering::Relaxed);
            return;
        }
    };

    let handles = config_handles();
    let state = WikiHttpState {
        app,
        storage,
        api_enabled: Arc::clone(&handles.api_enabled),
        allow_unauthenticated: Arc::clone(&handles.allow_unauthenticated),
        allow_lan_access: Arc::clone(&handles.allow_lan_access),
        mcp_enabled: Arc::clone(&handles.mcp_enabled),
        agent_enabled: Arc::clone(&handles.agent_enabled),
        api_token: Arc::clone(&handles.api_token),
        last_clip_at: Arc::clone(&handles.last_clip_at),
        clip_count: Arc::clone(&handles.clip_count),
    };

    let router = Router::new()
        .route("/health", get(clip_health))
        .route("/clip", post(clip_handler).options(clip_options))
        .route("/api/v1/health", get(api_health))
        .route("/api/v1/bases", get(api_spaces))
        .route("/api/v1/search", post(api_search).get(api_search_get))
        // 浏览器扩展用的 agent 代理：令牌不出 Rust 进程（见 `bridge/agent.rs`）
        .merge(super::agent::router())
        .with_state(state);

    let (tx, rx) = oneshot::channel::<()>();
    if let Ok(mut guard) = handles.shutdown_tx.lock() {
        *guard = Some(tx);
    }

    SERVER_RUNNING.store(true, Ordering::Relaxed);
    log::info!("知识剪藏/API 监听 {}:{}", host, port);
    if let Err(error) = axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = rx.await;
        })
        .await
    {
        log::error!("知识剪藏/API HTTP 服务退出: {error}");
    }
    SERVER_RUNNING.store(false, Ordering::Relaxed);
}

async fn restart_server() {
    let handles = config_handles();
    if let Ok(mut guard) = handles.shutdown_tx.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
    // 等旧 listener 释放端口
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let boot = match handles.boot.lock() {
        Ok(guard) => guard.clone(),
        Err(error) => {
            log::warn!("wiki http restart: boot lock poisoned: {error}");
            None
        }
    };
    let Some((app, storage)) = boot else {
        log::warn!("wiki http restart: missing boot handles");
        return;
    };
    bind_and_serve(app, storage).await;
}

/// 尝试绑定固定端口；失败只打日志，不阻断 app 启动。
pub async fn start(app: AppHandle, storage: Storage) {
    let handles = config_handles();
    if let Ok(mut guard) = handles.boot.lock() {
        *guard = Some((app.clone(), storage.clone()));
    }
    tauri::async_runtime::spawn(async move {
        bind_and_serve(app, storage).await;
    });
}

pub fn is_running() -> bool {
    SERVER_RUNNING.load(Ordering::Relaxed)
}

/// 给本机 HTTP 面的回包补 CORS。
///
/// `Access-Control-Allow-Origin: *` 在这里是安全的：没有「靠 cookie 才生效」的语义，
/// 身份一律走 `Authorization`。扩展有 host permission，本来不受 CORS 约束；这条是给
/// `curl` 与本地调试页用的。
pub(crate) fn with_cors(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, authorization, x-api-token"),
    );
    response
}

async fn clip_options() -> Response {
    with_cors(StatusCode::NO_CONTENT.into_response())
}

async fn clip_health(State(state): State<WikiHttpState>) -> Response {
    with_cors(
        Json(json!({
            "ok": true,
            "service": "cogito-clip",
            "port": clip_port(),
            "running": true,
            "clipCount": state.clip_count.load(Ordering::Relaxed),
            "lastClipAt": state.last_clip_at.load(Ordering::Relaxed),
        }))
        .into_response(),
    )
}

async fn clip_handler(
    State(state): State<WikiHttpState>,
    Json(body): Json<ClipPayload>,
) -> Response {
    if body.title.trim().is_empty() && body.markdown.trim().is_empty() {
        return with_cors(
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "empty clip" })),
            )
                .into_response(),
        );
    }

    if let Err(error) = state.app.emit("knowledge://clip", &body) {
        log::error!("knowledge://clip emit failed: {error}");
        return with_cors(
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "emit failed" })),
            )
                .into_response(),
        );
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    state.last_clip_at.store(now, Ordering::Relaxed);
    state.clip_count.fetch_add(1, Ordering::Relaxed);

    with_cors(StatusCode::OK.into_response())
}

fn authorize(state: &WikiHttpState, headers: &HeaderMap) -> bool {
    if !state.api_enabled.load(Ordering::Relaxed) {
        return false;
    }
    if state.allow_unauthenticated.load(Ordering::Relaxed) {
        return true;
    }
    let expected = state
        .api_token
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    if expected.trim().is_empty() {
        return true;
    }
    let presented = WikiHttpState::read_presented_token(headers);
    !presented.is_empty() && presented == expected
}

async fn api_health(State(state): State<WikiHttpState>, headers: HeaderMap) -> Response {
    let enabled = state.api_enabled.load(Ordering::Relaxed);
    let auth_ok = authorize(&state, &headers);
    if enabled && !auth_ok {
        return with_cors(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "ok": false, "error": "unauthorized" })),
            )
                .into_response(),
        );
    }
    with_cors(
        Json(json!({
            "ok": true,
            "status": if enabled { "running" } else { "disabled" },
            "enabled": enabled,
            "mcpEnabled": state.mcp_enabled.load(Ordering::Relaxed),
            "authRequired": !state.allow_unauthenticated.load(Ordering::Relaxed),
            "authConfigured": state
                .api_token
                .lock()
                .map(|guard| !guard.trim().is_empty())
                .unwrap_or(false),
            "allowUnauthenticated": state.allow_unauthenticated.load(Ordering::Relaxed),
            "allowLanAccess": state.allow_lan_access.load(Ordering::Relaxed),
            "bindHost": if state.allow_lan_access.load(Ordering::Relaxed) {
                "0.0.0.0"
            } else {
                "127.0.0.1"
            },
            "port": clip_port(),
            "clip": {
                "running": is_running(),
                "path": "/clip",
                "health": "/health"
            }
        }))
        .into_response(),
    )
}

async fn api_spaces(State(state): State<WikiHttpState>, headers: HeaderMap) -> Response {
    if !authorize(&state, &headers) {
        return with_cors(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "unauthorized" })),
            )
                .into_response(),
        );
    }
    match Service::toListSpaces(state.storage.connection()).await {
        Ok(bases) => with_cors(Json(bases).into_response()),
        Err(error) => with_cors(
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchBody {
    query: String,
    /// 线格式沿用 `baseId`（浏览器剪藏插件已按此发布），内部标识符叫 `space_id`。
    #[serde(rename = "baseId")]
    space_id: Option<String>,
    top_k: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: Option<String>,
    #[serde(rename = "baseId")]
    space_id: Option<String>,
    #[serde(rename = "topK")]
    top_k: Option<u32>,
}

async fn api_search(
    State(state): State<WikiHttpState>,
    headers: HeaderMap,
    Json(body): Json<SearchBody>,
) -> Response {
    run_search(state, headers, body.query, body.space_id, body.top_k).await
}

async fn api_search_get(
    State(state): State<WikiHttpState>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Response {
    run_search(
        state,
        headers,
        query.q.unwrap_or_default(),
        query.space_id,
        query.top_k,
    )
    .await
}

async fn run_search(
    state: WikiHttpState,
    headers: HeaderMap,
    query: String,
    space_id: Option<String>,
    top_k: Option<u32>,
) -> Response {
    if !authorize(&state, &headers) {
        return with_cors(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "unauthorized" })),
            )
                .into_response(),
        );
    }
    let limit = top_k.unwrap_or(20).clamp(1, 100) as usize;
    match Service::toSearch(
        state.storage.connection(),
        &query,
        space_id.as_deref(),
        limit,
    )
    .await
    {
        Ok(hits) => with_cors(Json(json!({ "hits": hits })).into_response()),
        Err(error) => with_cors(
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response(),
        ),
    }
}

/// 供前端更新 API 鉴权开关（进程内；重启后读 settings 再灌）。
#[tauri::command]
pub fn wiki_http_status() -> serde_json::Value {
    let handles = config_handles();
    let allow_lan = handles.allow_lan_access.load(Ordering::Relaxed);
    json!({
        "running": is_running(),
        "port": clip_port(),
        "enabled": handles.api_enabled.load(Ordering::Relaxed),
        "allowUnauthenticated": handles.allow_unauthenticated.load(Ordering::Relaxed),
        "allowLanAccess": allow_lan,
        "mcpEnabled": handles.mcp_enabled.load(Ordering::Relaxed),
        "agentEnabled": handles.agent_enabled.load(Ordering::Relaxed),
        "bindHost": if allow_lan { "0.0.0.0" } else { "127.0.0.1" },
        "authConfigured": handles
            .api_token
            .lock()
            .map(|guard| !guard.trim().is_empty())
            .unwrap_or(false),
        "clipHealth": format!("http://127.0.0.1:{}/health", clip_port()),
        "apiHealth": format!("http://127.0.0.1:{}/api/v1/health", clip_port()),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiHttpConfigPatch {
    pub enabled: Option<bool>,
    pub allow_unauthenticated: Option<bool>,
    pub allow_lan_access: Option<bool>,
    pub mcp_enabled: Option<bool>,
    /// agent 代理开关（浏览器扩展用；默认关闭）
    pub agent_enabled: Option<bool>,
    pub token: Option<String>,
}

/// 前端设置页灌入 Wiki API 鉴权 / LAN bind / MCP 开关（进程内热更新；LAN 变更会重绑端口）。
#[tauri::command]
pub fn wiki_http_configure(patch: WikiHttpConfigPatch) -> Result<(), String> {
    let handles = config_handles();
    if let Some(enabled) = patch.enabled {
        handles.api_enabled.store(enabled, Ordering::Relaxed);
    }
    if let Some(allow) = patch.allow_unauthenticated {
        handles
            .allow_unauthenticated
            .store(allow, Ordering::Relaxed);
    }
    if let Some(mcp) = patch.mcp_enabled {
        handles.mcp_enabled.store(mcp, Ordering::Relaxed);
    }
    if let Some(agent) = patch.agent_enabled {
        handles.agent_enabled.store(agent, Ordering::Relaxed);
    }
    let mut need_rebind = false;
    if let Some(allow_lan) = patch.allow_lan_access {
        let previous = handles.allow_lan_access.swap(allow_lan, Ordering::Relaxed);
        need_rebind = previous != allow_lan;
    }
    if let Some(token) = patch.token {
        let mut guard = handles
            .api_token
            .lock()
            .map_err(|error| format!("api token lock: {error}"))?;
        *guard = token;
    }
    if need_rebind {
        tauri::async_runtime::spawn(async {
            restart_server().await;
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderName;

    use super::*;

    fn headers_with(name: HeaderName, value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            name,
            HeaderValue::from_bytes(value.as_bytes()).expect("合法的 header 值"),
        );
        headers
    }

    /// 没配令牌 = 关闭 agent 面。写成「空就放行」等于装完客户端就有一个能改文件的入口。
    #[test]
    fn agent_token_rejects_when_not_configured() {
        assert!(!match_agent_token("", &HeaderMap::new()));
        assert!(!match_agent_token(
            "   ",
            &headers_with(header::AUTHORIZATION, "Bearer whatever")
        ));
    }

    #[test]
    fn agent_token_accepts_bearer_and_x_api_token() {
        assert!(match_agent_token(
            "abc",
            &headers_with(header::AUTHORIZATION, "Bearer abc")
        ));
        assert!(match_agent_token(
            "abc",
            &headers_with(HeaderName::from_static("x-api-token"), "abc")
        ));
    }

    #[test]
    fn agent_token_rejects_mismatch_and_missing() {
        assert!(!match_agent_token(
            "abc",
            &headers_with(header::AUTHORIZATION, "Bearer abd")
        ));
        assert!(!match_agent_token("abc", &HeaderMap::new()));
        // 不带 `Bearer ` 前缀的 Authorization 不算数（避免把别家 scheme 当成令牌）
        assert!(!match_agent_token(
            "abc",
            &headers_with(header::AUTHORIZATION, "abc")
        ));
    }
}
