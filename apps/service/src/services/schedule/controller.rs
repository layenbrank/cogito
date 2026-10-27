//! 定时任务接口层：取会话 → 进入租户作用域 → 交给信封。
//!
//! 与 `rag` 一致：租户来自 `X-Tenant-ID`（必填），权限判定由领域层 `authz` 完成。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::TenantId;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::schedule::schema::{JobP, JobPatchP};
use crate::services::schedule::service::Service;
use crate::utils::code::request;

pub struct ScheduleController;

impl ScheduleController {
    /// 列出本租户的任务（含最近一次执行状态）。
    pub async fn toList(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;
        let items = Service::list(&ctx).await?;
        ctx.rollback().await?;
        Envelope::write(items).transform()
    }

    /// 新建或整体替换一个任务；cron / 时区在保存时就校验。
    pub async fn toSave(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<JobP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;
        let job = Service::save(&ctx, req.into_inner()).await?;
        ctx.commit().await?;
        Envelope::write(job).transform()
    }

    /// 局部更新：只改传入的项；停用会清掉排期。
    pub async fn toPatch(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<JobPatchP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;
        let job = Service::patch(&ctx, &path, req.into_inner()).await?;
        ctx.commit().await?;
        Envelope::write(job).transform()
    }

    /// 删除任务（执行历史随行一起消失）。
    pub async fn toRemove(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;
        let removed = Service::remove(&ctx, &path).await?;
        ctx.commit().await?;
        Envelope::write(removed).transform()
    }
}

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

async fn enter(
    db: &Storage,
    session: &Session,
    http: &HttpRequest,
) -> Result<TenantCtx, Exception> {
    TenantCtx::enter(db, session, tenant_of(http)?).await
}

/// 请求头里的租户；「没带」与「格式不对」分开报，避免调用方查错方向。
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
