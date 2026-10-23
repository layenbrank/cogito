use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::payment::billing_controller::BillingController;
use crate::services::payment::controller::PaymentController;

/// 支付路由。
///
/// 与订阅模块同一套挂载法则：**只注册相对路径的 `web::resource`**，由父级 scope 提供前缀，
/// 避免与父级前缀 scope 同层并列时被 actix 的 `ResourceMap` 吞掉。
pub struct PaymentModule;

impl PaymentModule {
    /// 租户面：挂在 `TenantModule` 的 `/tenants` scope 下（继承登录鉴权）。
    pub fn configure_tenant(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::resource("/{id}/orders")
                .route(web::get().to(PaymentController::toList))
                .route(web::post().to(PaymentController::toWrite)),
        )
        .service(
            web::resource("/{id}/orders/{orderNo}").route(web::get().to(PaymentController::detail)),
        )
        .service(
            web::resource("/{id}/orders/{orderNo}/sync")
                .route(web::post().to(PaymentController::sync)),
        )
        .service(
            web::resource("/{id}/orders/{orderNo}/close")
                .route(web::post().to(PaymentController::close)),
        )
        // 档位 / 渠道目录
        .service(
            web::resource("/{id}/pay/catalog").route(web::get().to(PaymentController::catalog)),
        );
    }

    /// 渠道回调：挂在 `/api/v1` scope 下，**匿名**（真实性与时效性由渠道签名校验保证）。
    pub fn configure_notify(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::resource("/pay/notify/wechat")
                .route(web::post().to(PaymentController::notify_wechat)),
        )
        .service(
            web::resource("/pay/notify/alipay")
                .route(web::post().to(PaymentController::notify_alipay)),
        );
    }

    /// 计费运维面：挂在 `/api/v1` scope 下，自带 `/billing` 前缀，逐条要求平台 ADMIN。
    ///
    /// 价目决定全平台怎么计费、对账看的是全平台的钱，所以这一组接口**没有租户面**：
    /// 可见范围由角色决定，而不是由请求头里写了哪个租户决定。
    pub fn configure_billing(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/billing")
                .wrap(Auth::isRequired())
                .service(
                    web::resource("/prices")
                        .wrap(Auth::admin())
                        .route(web::get().to(BillingController::prices))
                        .route(web::post().to(BillingController::price_write)),
                )
                .service(
                    web::resource("/prices/{id}")
                        .wrap(Auth::admin())
                        .route(web::put().to(BillingController::price_update))
                        .route(web::delete().to(BillingController::price_archive)),
                )
                .service(
                    web::resource("/reconciliation")
                        .wrap(Auth::admin())
                        .route(web::get().to(BillingController::reconciliation)),
                )
                // 导出必须是独立 resource：`/reconciliation` 上挂的是单端点，路径再长一段
                // 不会落进它（与网关 `/audit` 和 `/audit/export` 的关系同理）。
                .service(
                    web::resource("/reconciliation/export")
                        .wrap(Auth::admin())
                        .route(web::get().to(BillingController::reconciliation_export)),
                ),
        );
    }
}
