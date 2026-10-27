//! 桥的 HTTP 层：两个端点，一层 token 校验。
//!
//! `cogito-mcp` 侧约定见 `crates/mcp/src/main.rs`；工具目录与实现都在
//! `cogito_core::tools`，这里只做传输与鉴权。

use std::{net::Ipv4Addr, sync::Arc};

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
use tokio::net::TcpListener;

/// 侧车带过来的凭据头（与 `crates/mcp` 的 `BRIDGE_TOKEN_HEADER` 对齐）。
pub const TOKEN_HEADER: &str = "x-bridge-token";

/// 桥的对外信息：只给本机侧车用，token 每次启动轮换。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub url: String,
    pub token: String,
}

/// 桥的 Tauri state：前端经 `bridge:info` 取 url/token 再注入给侧车。
pub struct BridgeState {
    info: BridgeInfo,
}

impl BridgeState {
    #[must_use]
    pub fn info(&self) -> &BridgeInfo {
        &self.info
    }
}

#[derive(Clone)]
struct AppState {
    storage: Storage,
    token: Arc<str>,
}

/// 绑定随机端口并后台运行；返回可直接注入给侧车的 `{url, token}`。
pub async fn start(storage: Storage) -> anyhow::Result<BridgeState> {
    let token = uuid::Uuid::new_v4().to_string();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let address = listener.local_addr()?;
    let app = router(storage, token.clone());

    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!("cogito 桥退出: {error}");
        }
    });

    Ok(BridgeState {
        info: BridgeInfo {
            url: format!("http://{address}"),
            token,
        },
    })
}

/// 路由装配（单独暴露，便于测试直接 drive）。
pub fn router(storage: Storage, token: String) -> Router {
    Router::new()
        .route("/internal/tools/list", get(list_tools))
        .route("/internal/tools/call", post(call_tool))
        .with_state(AppState {
            storage,
            token: Arc::from(token),
        })
}

fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    // Host 必须是回环地址：防止 DNS rebinding 把本机桥暴露给网页。
    if let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    {
        let hostname = host.rsplit_once(':').map_or(host, |(name, _)| name);
        if hostname != "127.0.0.1" && hostname != "localhost" {
            return Err(reject("Host 不是本机地址"));
        }
    }

    let token = headers
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if token != state.token.as_ref() {
        return Err(reject("token 无效"));
    }

    Ok(())
}

fn reject(reason: &str) -> Response {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": reason }))).into_response()
}

async fn list_tools(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = authorize(&state, &headers) {
        return response;
    }
    Json(json!({ "tools": cogito_core::tools::catalog() })).into_response()
}

#[derive(Debug, Deserialize)]
struct CallBody {
    name: String,
    #[serde(default)]
    arguments: Value,
}

async fn call_tool(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CallBody>,
) -> Response {
    if let Err(response) = authorize(&state, &headers) {
        return response;
    }
    // 工具级失败走 200 + `ok:false`：让模型看到原因，而不是协议错误。
    match cogito_core::tools::call(state.storage.connection(), &body.name, &body.arguments).await {
        Ok(value) => Json(json!({ "ok": true, "value": value })).into_response(),
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

    #[tokio::test]
    async fn rejects_missing_token() {
        let app = router(test_storage().await, "secret".to_string());
        let response = app
            .oneshot(request("/internal/tools/list", None))
            .await
            .expect("route");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn lists_read_only_tools() {
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
}
