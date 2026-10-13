//! 会话同步接口层：每个 Handler 只做三件事——取会话、进入租户作用域、把结果交给信封。
//!
//! 租户来自 `X-Tenant-ID`（与 `rag` / `agent` 同一约定），本域**要求必填**：会话按租户隔离，
//! 缺了头就没有正确的作用域可进，与其猜一个不如直接 400。
//!
//! 两条路径的事务寿命不同：
//! - 推送是写路径：领域函数在事务里落完一批，Handler 显式 `commit`（未提交即回滚）；
//! - 拉取是读路径：读完就 `rollback` 还连接，不占着连接等下一次请求。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::TenantId;
use serde::Deserialize;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::chat::schema::{ChatSyncP, ChatSyncR};
use crate::services::chat::service::{ChangesQuery, ChatService};
use crate::utils::code::request;

/// 拉取参数。`since` 缺省为 0（从头拉），`limit` 缺省由契约决定。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatChangesQuery {
    #[serde(default)]
    pub since: i64,
    pub limit: Option<u64>,
}

pub struct ChatController;

impl ChatController {
    /// 推一批改动：会话 / 消息 / 用量 / 删除。
    ///
    /// 幂等由 `clientBatchID` 保证：网络抖动下重发同一批不会重复落库，也不会推高水位。
    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<ChatSyncP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;

        let result: ChatSyncR = match ChatService::apply(&ctx, req.into_inner()).await {
            Ok(result) => result,
            Err(err) => return err.transform(),
        };
        ctx.commit().await?;

        Envelope::write(result).transform()
    }

    /// 拉一个增量窗口：按水位升序返回若干**整批**变更，含删除墓碑。
    pub async fn toRead(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<ChatChangesQuery>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;

        let params = ChangesQuery {
            since: query.since,
            limit: query.limit,
        };
        let result = match ChatService::changes(&ctx, params).await {
            Ok(result) => result,
            Err(err) => return err.transform(),
        };
        ctx.rollback().await?;

        Envelope::success(result, "获取同步增量成功").transform()
    }
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
///
/// 「没带」与「带了但格式不对」分开报：前者是调用方漏了参数，后者是写了错值，
/// 混成一句话会让人反复检查一个其实没写错的地方。
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
