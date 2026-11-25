//! 本机 Agent 代理：浏览器扩展经此驱动 agentd 的会话面。
//!
//! ## 为什么是代理，而不是「把 endpoint 交给扩展」
//!
//! agentd 的 Bearer 令牌能拿到**带写文件、执行命令能力**的 agent。渲染进程拿到它已经是
//! 权宜（见 `system/command.rs` 的注释）；再交给扩展就等于把这份凭据塞进另一套进程模型里，
//! 任何能读到扩展 storage 的东西都能直接驱动 agent。代理让 agentd 令牌只活在 Rust 进程：
//! 扩展带的是**本机 API 令牌**（用户在设置页显式生成），Rust 再换成 agentd 令牌转发。
//!
//! ## 为什么一条通配路由转发所有路径
//!
//! agentd 的会话面还会长。逐条在 Rust 里复写一遍，等于给协议加第三份真源（前端已经有一份
//! `AGENTD_ROUTES`，见 `@cogito/agent-runtime/agentd/runs`）。这里只做「鉴权 → 换令牌 →
//! 透传」，路径原样交出去；新端点不需要改 Rust。
//!
//! ## 三条硬约束
//!
//! - **令牌永远是必需的**：不走 `allow_unauthenticated`。那个开关是给只读 Wiki API 的，
//!   agent 面写着「能改你的文件」，不能因为「图省事没配令牌」就退化成无鉴权。
//! - **LAN 一律 403**：`allowLanAccess` 会把 19828 绑到 `0.0.0.0`，那是只读 API 的便利；
//!   agent 面暴露到局域网等于把整台机器的执行权交给同网段。
//! - **SSE 不缓冲**：`GET .../events` 必须逐帧到浏览器，整包缓冲会让界面在整轮结束前
//!   一个字都不出（用户以为卡死）。
//!
//! ## 开关
//!
//! `agentEnabled` 默认 **false**。用户必须先在桌面端设置里生成令牌并打开开关，
//! 扩展才能连上 —— 默认关是刻意的：装完客户端就有一个无鉴权的执行入口是不可接受的。

use std::sync::OnceLock;

use axum::extract::DefaultBodyLimit;
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{OriginalUri, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use futures_util::stream;
use serde_json::json;
use tauri::Manager;

use super::clip::{WikiHttpState, clip_port, with_cors};
use crate::utils::agentd::{AgentdEndpoint, AgentdState};

/// 代理前缀。其后部分与 agentd 自己的路由表逐字对应（`/threads/...`、`/goose/invoke`）。
const PREFIX: &str = "/api/v1/agent";

/// 挂到 `bridge::clip` 的 axum Router 上（同一个 19828 端口、同一套状态）。
///
/// 只注册**一条**通配路由，`status` 在 handler 里按路径分派：matchit 虽然支持
/// 静态段与通配共存，但一旦写错就是「整个 19828 起不来」，而这条服务器同时背着剪藏。
/// 单入口没有这个风险，代价只是多一次字符串比较。
pub(crate) fn router() -> Router<WikiHttpState> {
    Router::new()
        .route(&format!("{PREFIX}/{{*path}}"), any(handle))
        // axum 的 `Bytes` 默认 2MB：一次带长选区/长正文的 prompt 会在这里撞 413，
        // 而用户看到的只是一个莫名 413。这是鉴权过的本机回环，放宽到 16MB。
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
}

/// 本机回环请求必须禁用代理：reqwest 会读 Windows 系统代理，走代理时本机请求回 502。
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap_or_else(|error| {
                log::warn!("构建 agentd 代理客户端失败，回退默认客户端: {error}");
                reqwest::Client::new()
            })
    })
}

fn find_endpoint(state: &WikiHttpState) -> Option<AgentdEndpoint> {
    state.app.try_state::<AgentdState>()?.endpoint()
}

fn problem(status: StatusCode, message: &str) -> Response {
    with_cors((status, Json(json!({ "error": message }))).into_response())
}

/// 代理状态。**不需要令牌** —— 但也不告诉调用方任何能用的东西。
///
/// 扩展要先分清「开关没开」「没配令牌」「令牌不对」「agentd 没就绪」四种情况，
/// 才能给出可读的提示；所以这条必须免鉴权，但只回状态，不回任何凭据或数据。
fn status_response(state: &WikiHttpState, headers: &HeaderMap) -> Response {
    let endpoint = find_endpoint(state);
    let restarts = state
        .app
        .try_state::<AgentdState>()
        .map(|agentd| agentd.restarts())
        .unwrap_or(0);
    with_cors(
        Json(json!({
            "enabled": state.agent_enabled.load(std::sync::atomic::Ordering::Relaxed),
            "authRequired": true,
            "authConfigured": state
                .api_token
                .lock()
                .map(|guard| !guard.trim().is_empty())
                .unwrap_or(false),
            "authorized": state.is_agent_authorized(headers),
            "lanExposed": state.allow_lan_access.load(std::sync::atomic::Ordering::Relaxed),
            "agentdReady": endpoint.is_some(),
            "agentdVersion": endpoint.as_ref().map(|value| value.version.clone()),
            "restarts": restarts,
            "port": clip_port(),
            "basePath": PREFIX,
        }))
        .into_response(),
    )
}

async fn handle(
    State(state): State<WikiHttpState>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // 预检不带 Authorization，先放行；真正的鉴权在下面
    if method == Method::OPTIONS {
        return with_cors(StatusCode::NO_CONTENT.into_response());
    }
    if uri.path() == format!("{PREFIX}/status") {
        return status_response(&state, &headers);
    }
    if state
        .allow_lan_access
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        return problem(
            StatusCode::FORBIDDEN,
            "agent 代理不允许在局域网可达时使用：请关闭「允许局域网访问」",
        );
    }
    if !state
        .agent_enabled
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "agent 代理未启用：请到桌面端 设置 → 本机 API 打开开关",
        );
    }
    if !state.is_agent_authorized(&headers) {
        return problem(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Some(endpoint) = find_endpoint(&state) else {
        return problem(StatusCode::SERVICE_UNAVAILABLE, "agentd 未就绪");
    };

    let suffix = uri.path().strip_prefix(PREFIX).unwrap_or(uri.path());
    let mut target = format!("{}{}", endpoint.base_url.trim_end_matches('/'), suffix);
    if let Some(query) = uri.query() {
        target.push('?');
        target.push_str(query);
    }

    let mut request = client()
        .request(method, &target)
        .header(header::AUTHORIZATION, format!("Bearer {}", endpoint.token));
    if let Some(content_type) = headers.get(header::CONTENT_TYPE) {
        request = request.header(header::CONTENT_TYPE, content_type.clone());
    }
    if let Some(accept) = headers.get(header::ACCEPT) {
        request = request.header(header::ACCEPT, accept.clone());
    }
    if !body.is_empty() {
        request = request.body(body);
    }

    let upstream = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            log::warn!("agent 代理转发 {target} 失败: {error}");
            return problem(StatusCode::BAD_GATEWAY, "agentd 转发失败");
        }
    };

    let status = upstream.status();
    let content_type = upstream.headers().get(header::CONTENT_TYPE).cloned();
    let cache_control = upstream.headers().get(header::CACHE_CONTROL).cloned();

    // 逐块转发而不是先收全：`events` 是 SSE，缓冲会让整轮期间界面一个字都不出。
    // 用 `unfold` 直接驱动上游响应，省掉一个 mpsc 中转（也就没有背压丢失）。
    let chunks = stream::unfold(upstream, |mut response| async move {
        match response.chunk().await {
            Ok(Some(chunk)) => Some((Ok::<Bytes, std::io::Error>(chunk), response)),
            Ok(None) => None,
            Err(error) => Some((Err(std::io::Error::other(error)), response)),
        }
    });

    let mut builder = Response::builder().status(status);
    if let Some(value) = content_type {
        builder = builder.header(header::CONTENT_TYPE, value);
    }
    if let Some(value) = cache_control {
        builder = builder.header(header::CACHE_CONTROL, value);
    }
    builder = builder.header("x-accel-buffering", HeaderValue::from_static("no"));

    let response = builder
        .body(Body::from_stream(chunks))
        .unwrap_or_else(|error| {
            log::warn!("agent 代理构造回包失败: {error}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        });

    with_cors(response)
}
