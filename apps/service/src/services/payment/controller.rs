//! 支付接口层：每个 Handler 只做三件事：取会话、进入租户作用域（[`TenantCtx`]）、把结果交给信封。
//! 权限判定在领域层由 `authz` 完成，这里不再自己比角色。
//!
//! 例外是两条**渠道回调**（微信 / 支付宝）：它们是匿名端点，没有会话也没有租户路径参数，
//! 作用域由领域层用订单号（能力键）引导，回执必须是渠道要求的原始报文、不能经过平台信封。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::TenantId;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::payment::channel::{ALIPAY, NotifyInput, WECHAT};
use crate::services::payment::schema::OrderP;
use crate::services::payment::service::{PaymentError, PaymentService};

/// 订单列表一次返回的条数。
const ORDER_LIST_LIMIT: u64 = 20;

/// 微信支付回执（**必须**是微信要求的原始报文，不能套平台响应信封）。
const WECHAT_ACK_OK: &str = r#"{"code":"SUCCESS","message":"成功"}"#;
const WECHAT_ACK_FAIL: &str = r#"{"code":"FAIL","message":"验签或处理失败"}"#;
/// 支付宝回执（纯文本，无信封、无 JSON）。
const ALIPAY_ACK_OK: &str = "success";
const ALIPAY_ACK_FAIL: &str = "failure";

pub struct PaymentController;

impl PaymentController {
    /// 价格 / 渠道目录（含当前生效档位）。
    ///
    /// 领域层可能顺手结算已过期的订阅，所以读路径也要提交。
    pub async fn catalog(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match PaymentService::catalog(&ctx, &config, &redis).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::success(item, "获取支付目录成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 订单列表（最近 20 条）。
    ///
    /// 领域层会顺手关闭本租户的超时订单，所以读路径也要提交。
    pub async fn toList(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match PaymentService::list(&ctx, &config, ORDER_LIST_LIMIT).await {
            Ok(items) => {
                ctx.commit().await?;
                Envelope::success(items, "获取订单列表成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 下单：返回 `codeUrl` 供客户端渲染二维码。
    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<OrderP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let mut ctx = enter(&db, &session, &path.into_inner()).await?;

        match PaymentService::create(&mut ctx, &db, &config, req.into_inner()).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::write(item).transform()
            }
            Err(err) => keep_writes(ctx, err).await,
        }
    }

    /// 订单详情。
    pub async fn detail(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        path: web::Path<(String, String)>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let (tenant_id, order_no) = path.into_inner();
        let ctx = enter(&db, &session, &tenant_id).await?;

        match PaymentService::get(&ctx, &config, &order_no).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::success(item, "获取订单成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 主动查单（回调丢失兜底 / 客户端「刷新支付状态」）。
    pub async fn sync(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<(String, String)>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let (tenant_id, order_no) = path.into_inner();
        let mut ctx = enter(&db, &session, &tenant_id).await?;

        match PaymentService::sync(&mut ctx, &db, &config, &redis, &order_no).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::success(item, "订单状态已同步").transform()
            }
            Err(err) => keep_writes(ctx, err).await,
        }
    }

    /// 关闭订单（用户取消支付）。
    pub async fn close(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        path: web::Path<(String, String)>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let (tenant_id, order_no) = path.into_inner();
        let ctx = enter(&db, &session, &tenant_id).await?;

        match PaymentService::close(&ctx, &config, &order_no).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::success(item, "订单已关闭").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 微信支付结果通知（匿名端点，安全完全依赖签名校验 + 金额核对）。
    ///
    /// 回执必须符合微信约定：成功 `200 {"code":"SUCCESS"}`，失败 `500 {"code":"FAIL"}`，
    /// 否则微信会持续重试或直接把该笔标记为异常。
    pub async fn notify_wechat(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        body: web::Bytes,
    ) -> Result<HttpResponse> {
        let body = String::from_utf8_lossy(&body).to_string();
        let input = NotifyInput {
            body: &body,
            timestamp: header(&http, "Wechatpay-Timestamp"),
            nonce: header(&http, "Wechatpay-Nonce"),
            signature: header(&http, "Wechatpay-Signature"),
            serial: header(&http, "Wechatpay-Serial"),
        };
        match PaymentService::notify(&db, &config, &redis, WECHAT, input).await {
            Ok(()) => Ok(json_ack(WECHAT_ACK_OK, 200)),
            Err(err) => {
                tracing::error!(error = %err, "wechat notify rejected");
                Ok(json_ack(WECHAT_ACK_FAIL, 500))
            }
        }
    }

    /// 支付宝异步通知（匿名端点）。
    ///
    /// 回执是纯文本 `success` / `failure`：返回 `failure` 时支付宝会按节奏重试，
    /// 因此**只有**验签、金额核对、开通订阅全部成功才应答 `success`。
    pub async fn notify_alipay(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        body: web::Bytes,
    ) -> Result<HttpResponse> {
        let body = String::from_utf8_lossy(&body).to_string();
        let input = NotifyInput {
            body: &body,
            timestamp: None,
            nonce: None,
            signature: None,
            serial: None,
        };
        match PaymentService::notify(&db, &config, &redis, ALIPAY, input).await {
            Ok(()) => Ok(text_ack(ALIPAY_ACK_OK)),
            Err(err) => {
                tracing::error!(error = %err, "alipay notify rejected");
                Ok(text_ack(ALIPAY_ACK_FAIL))
            }
        }
    }
}

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

/// 收尾「已经动过账」的失败：提交事务再返回错误。
///
/// 支付域的失败不总是「什么都没发生」：下单失败会把订单关掉、超时查单会关单、金额不符会留 `remark`，
/// 这些写入必须落库（否则用户看到的是一张永远不过期的待支付订单，对账也少了依据）。
/// 由 [`PaymentError::keeps_writes`] 表态，没动过账（或事务已中止）的错误直接回滚。
async fn keep_writes(ctx: TenantCtx, err: PaymentError) -> Result<HttpResponse> {
    if err.keeps_writes() {
        ctx.commit().await?;
    }
    Exception::from(err).transform()
}

/// 进入 `{tenantID}` 指向的租户作用域：非成员在这里就被拒（403）。
async fn enter(db: &Storage, session: &Session, tenant_raw: &str) -> Result<TenantCtx, Exception> {
    let tenant = tenant_raw
        .parse::<TenantId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))?;

    TenantCtx::enter(db, session, tenant).await
}

/// 读取请求头（缺失 / 非 UTF-8 视为缺失，交由渠道层报「签名头不全」）。
fn header<'a>(http: &'a HttpRequest, name: &str) -> Option<&'a str> {
    http.headers().get(name)?.to_str().ok()
}

fn json_ack(body: &str, status: u16) -> HttpResponse {
    HttpResponse::build(actix_web::http::StatusCode::from_u16(status).unwrap_or_default())
        .content_type("application/json")
        .body(body.to_string())
}

fn text_ack(body: &str) -> HttpResponse {
    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .body(body.to_string())
}
