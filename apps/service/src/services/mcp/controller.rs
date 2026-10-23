//! MCP 接口层：鉴权 + 租户作用域 + JSON-RPC 分发。
//!
//! MCP 是 streamable HTTP 上的 JSON-RPC 2.0，响应体**不走**统一 REST 信封：成功回
//! `{"jsonrpc":"2.0","id":...,"result":...}`，失败回 `{"jsonrpc":"2.0","id":...,"error":...}`，
//! HTTP 状态码恒为 200（协议错误也如此）。只有 **HTTP 层鉴权失败**（未登录 / 非租户成员）
//! 才走本仓库的 `Exception` 信封（401 / 403）——那时还没有可响应的 JSON-RPC id。
//!
//! 本端点只实现 **POST**（纯 JSON 响应，不支持 SSE 的服务端推送）：客户端探测到不支持
//! SSE 后按规范退化为无通知模式，这不影响 `tools/list` / `tools/call` 的同步往返。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::TenantId;
use serde_json::json;

use crate::clients::compute::ComputeClient;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::services::mcp::error::RpcError;
use crate::services::mcp::schema::JsonRpcRequest;
use crate::services::mcp::service::McpService;
use crate::utils::code::request;

pub struct McpController;

impl McpController {
    /// 一条 JSON-RPC 消息的入口：鉴权 → 分发 → 包装 JSON-RPC 响应。
    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        compute: web::Data<Option<Arc<ComputeClient>>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        body: web::Bytes,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;
        let tenant_id = ctx.tenant_id();
        // 成员校验已经做完，下面的 compute 转发是外部调用，不能挂在事务里。
        ctx.rollback().await?;

        let request: JsonRpcRequest = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(err) => return Ok(rpc_err(serde_json::Value::Null, RpcError::parse_error(format!("Parse error: {err}")))),
        };
        if request.jsonrpc != mcp::RPC_VERSION {
            return Ok(rpc_err(
                serde_json::Value::Null,
                RpcError::invalid_request(format!("jsonrpc 必须是 {}", mcp::RPC_VERSION)),
            ));
        }

        // notification（无 id）：MCP 客户端发的 `notifications/*`，按规范不响应。
        let Some(id) = request.id else {
            return Ok(HttpResponse::Accepted()
                .content_type("application/json")
                .finish());
        };

        let result = McpService::handle(
            compute.get_ref().as_ref(),
            &tenant_id.to_string(),
            &config.compute.embed_model,
            &request.method,
            request.params,
            None,
        )
        .await;

        match result {
            Ok(result) => Ok(rpc_ok(id, result)),
            Err(err) => Ok(rpc_err(id, err)),
        }
    }
}

/// 成功响应（HTTP 200，JSON-RPC `result`）。
fn rpc_ok(id: serde_json::Value, result: serde_json::Value) -> HttpResponse {
    HttpResponse::Ok()
        .content_type("application/json")
        .json(json!({ "jsonrpc": mcp::RPC_VERSION, "id": id, "result": result }))
}

/// 协议错误响应（HTTP 200，JSON-RPC `error`）。
fn rpc_err(id: serde_json::Value, err: RpcError) -> HttpResponse {
    HttpResponse::Ok()
        .content_type("application/json")
        .json(json!({
            "jsonrpc": mcp::RPC_VERSION,
            "id": id,
            "error": { "code": err.code, "message": err.message },
        }))
}

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

/// 进入 `X-Tenant-ID` 指向的租户作用域：非成员在这里就被拒（403）。
async fn enter(
    db: &Storage,
    session: &Session,
    http: &HttpRequest,
) -> Result<TenantCtx, Exception> {
    TenantCtx::enter(db, session, tenant_of(http)?).await
}

/// 请求头里的租户。
fn tenant_of(http: &HttpRequest) -> Result<TenantId, Exception> {
    let raw = http
        .headers()
        .get("X-Tenant-ID")
        .ok_or_else(|| Exception::custom(request::MISSING_PARAMETER, "缺少 X-Tenant-ID 请求头"))?;

    raw.to_str()
        .ok()
        .and_then(|value| value.trim().parse::<TenantId>().ok())
        .ok_or_else(|| Exception::custom(request::INVALID_HEADER, "X-Tenant-ID 格式无效"))
}
