//! 计费运维面 HTTP 入口：价目管理与计量对账。
//!
//! 这里是**平台面**：价目是全平台的结算参数，对账看的是全平台的钱，两者都不该由租户自助。
//! 因此每个 handler 都显式进入平台特权作用域，路由在
//! [`crate::services::payment::module::PaymentModule::configure_billing`] 里逐条挂
//! `Auth::admin()`。
//!
//! 作用域在这里显式收尾：只读回滚、写入提交，领域函数永远拿不到「裸连接」。
//! 与网关管理面同一套顺序，只有一点不同——返回 `HttpResponse` 的能力被放进了回调，
//! 于是导出这种「几万行拼串」的活儿发生在事务归还之后。

use std::sync::Arc;

use actix_web::http::header::{ContentDisposition, DispositionParam, DispositionType};
use actix_web::{HttpRequest, HttpResponse, Result, web};
use billing::Reconciliation;
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::session::Session;
use crate::interceptors::envelope::Envelope;
use crate::services::payment::billing_price::{PriceFilter, PriceService};
use crate::services::payment::reconcile::{ReconcileFilter, ReconcileService, to_response};
use crate::services::payment::render;
use crate::services::payment::schema::{
    PriceQueryP, PriceUpdateP, PriceWriteP, ReconcileExportFormat, ReconcileExportP,
    ReconcileQueryP,
};
use crate::services::payment::service::CURRENCY;
use crate::utils::code::external;

pub struct BillingController;

impl BillingController {
    // ---- 价目（`/api/v1/billing/prices`）----

    /// 价目列表。查询条件写错时**不报错**，只当没给这个条件：运维是拿它来「翻一翻现在什么价」，
    /// 多一次 400 只会让人换个姿势再试一次。
    pub async fn prices(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<PriceQueryP>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let filter = match PriceFilter::parse(&query) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = PriceService::list(&scope, &filter).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取价目成功").transform()
        })
        .await
    }

    /// 新建价目。只允许「加一条新的生效窗口」，不允许原地改价——见 `PriceUpdateP` 的说明。
    pub async fn price_write(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        payload: web::Json<PriceWriteP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            PriceService::create(&scope, session.user_id().as_uuid(), payload.into_inner()).await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    /// 改价目：只开放 `modelName` 与 `effectiveTo`（收窄窗口）。
    pub async fn price_update(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        payload: web::Json<PriceUpdateP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = PriceService::update(
            &scope,
            session.user_id().as_uuid(),
            id,
            payload.into_inner(),
        )
        .await;
        platform_write(scope, result, |item| {
            Envelope::success(item, "更新价目成功").transform()
        })
        .await
    }

    /// 归档价目：软删除。历史对账仍然指向这条价目，所以它永远不物理消失。
    /// 重复归档返回成功（幂等），运维重试一次不该看到报错。
    pub async fn price_archive(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = PriceService::archive(&scope, session.user_id().as_uuid(), id).await;
        platform_write(scope, result, |()| {
            Envelope::message_only("归档价目成功").transform()
        })
        .await
    }

    // ---- 对账（`/api/v1/billing/reconciliation`）----

    /// 跑一次对账。窗口条件与结果都走 JSON 信封。
    pub async fn reconciliation(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<ReconcileQueryP>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let filter = match ReconcileFilter::parse(&query, CURRENCY) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ReconcileService::report(&scope, &filter).await;
        platform_read(scope, result, |report| {
            Envelope::success(to_response(&report), "对账完成").transform()
        })
        .await
    }

    /// 对账导出：与查询同一组窗口条件，但输出**原始文件字节**而不是 JSON 信封。
    ///
    /// 命中 0 条不是 404：窗口内没有流水是合法结果，此时文件只有表头。空结果报错会让
    /// 排查脚本把「真的没发生」误判成「导出坏了」。
    pub async fn reconciliation_export(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<ReconcileExportP>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let format = query.format.unwrap_or(ReconcileExportFormat::Csv);
        // 导出与查询共用同一套窗口解析：多一条平行实现，就可能多出一份对不上的口径。
        let filter = match ReconcileFilter::parse(
            &ReconcileQueryP {
                from: query.from,
                to: query.to,
                tenant_id: query.tenant_id.clone(),
                currency: query.currency.clone(),
            },
            CURRENCY,
        ) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ReconcileService::report(&scope, &filter).await;
        // 渲染放进回调：事务先归还，几十万行的拼串不占着数据库连接。
        platform_read(scope, result, |report| {
            Ok(reconciliation_download(&report, format))
        })
        .await
    }
}

/// 把对账结果摊平、渲染成下载响应：原始字节 + 下载头，**不套 JSON 信封**。
///
/// `X-Export-*` 两个头是给脚本读的：`rows` 说明拿到多少行，`truncated=true` 说明命中量超过
/// 硬上限、文件里只剩靠前的那批——只看文件内容无法区分「就这么多」和「被截断了」。
fn reconciliation_download(report: &Reconciliation, format: ReconcileExportFormat) -> HttpResponse {
    let export = render::build(report);
    HttpResponse::Ok()
        .content_type(render::content_type(format))
        .insert_header(("X-Export-Rows", export.rows.len().to_string()))
        .insert_header(("X-Export-Truncated", export.truncated.to_string()))
        .insert_header(ContentDisposition {
            disposition: DispositionType::Attachment,
            parameters: vec![DispositionParam::Filename(render::filename(
                report.from_millis,
                report.to_millis,
                format,
            ))],
        })
        .body(render::render(format, &export.rows))
}

/// 只读处理：成功先归还事务再出响应；失败尽力回滚（回滚失败也不能盖掉原始错误）。
///
/// 泛化了网关管理面那一版：这里会同时遇到 `PriceError` 与 `ReconcileError`，
/// 而它们都已经实现 `Into<Exception>`，所以只要求 `E: Into<Exception>` 就够。
async fn platform_read<T, E, F>(
    scope: PlatformScope,
    result: std::result::Result<T, E>,
    ok: F,
) -> Result<HttpResponse>
where
    E: Into<Exception>,
    F: FnOnce(T) -> Result<HttpResponse>,
{
    match result {
        Ok(data) => {
            scope.rollback().await.map_err(db_error)?;
            ok(data)
        }
        Err(err) => {
            if let Err(e) = scope.rollback().await {
                tracing::warn!(error = %e, "平台作用域回滚失败");
            }
            err.into().transform()
        }
    }
}

/// 写入处理：**先提交再出响应**，提交失败绝不回 200（否则前端会以为写成功了）。
async fn platform_write<T, E, F>(
    scope: PlatformScope,
    result: std::result::Result<T, E>,
    ok: F,
) -> Result<HttpResponse>
where
    E: Into<Exception>,
    F: FnOnce(T) -> Result<HttpResponse>,
{
    match result {
        Ok(data) => {
            scope.commit().await.map_err(db_error)?;
            ok(data)
        }
        Err(err) => {
            if let Err(e) = scope.rollback().await {
                tracing::warn!(error = %e, "平台作用域回滚失败");
            }
            err.into().transform()
        }
    }
}

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

/// 路径上的价目 id。不合法的 UUID 是 400 而不是 404：路由已经匹配上了，
/// 是参数写错而不是资源不存在。
fn parse_id(value: &str) -> Result<Uuid, Exception> {
    Uuid::parse_str(value).map_err(|_| Exception::bad_request("ID 格式无效"))
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "billing scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
