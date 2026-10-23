use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::gateway::module::GatewayModule;
use crate::services::payment::module::PaymentModule;
use crate::services::subscription::module::SubscriptionModule;
use crate::services::tenant::admin_controller::AdminTenantController;
use crate::services::tenant::controller::TenantController;

pub struct TenantModule;

impl TenantModule {
    /// 「我的租户」：当前用户所属租户；语义不变，勿与运维面混淆。
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/tenants")
                .wrap(Auth::isRequired())
                // 订阅 / 配额：相对路径资源注册进本 scope（见 SubscriptionModule 注释）
                .configure(SubscriptionModule::configure)
                // 支付订单 / 价格目录：同一套相对路径注册法则
                .configure(PaymentModule::configure_tenant)
                // 网关审计（本租户只读）：同一套相对路径注册法则
                .configure(GatewayModule::configure_tenant)
                .route("", web::get().to(TenantController::toList))
                .route("", web::post().to(TenantController::toWrite))
                .route("/{id}", web::get().to(TenantController::toRead_by_id))
                .route("/{id}", web::put().to(TenantController::toUpdate))
                .route("/{id}", web::delete().to(TenantController::toRemove))
                .route("/{id}/members", web::get().to(TenantController::members))
                .route(
                    "/{id}/members",
                    web::post().to(TenantController::member_add),
                )
                .route(
                    "/{id}/members/{userID}",
                    web::put().to(TenantController::member_update),
                )
                .route(
                    "/{id}/members/{userID}",
                    web::delete().to(TenantController::member_remove),
                ),
        );
    }

    /// 平台运维面：全量租户管理。独立前缀，避免污染 `GET /tenants`（我的租户）。
    ///
    /// 逐条 `web::resource` + `Auth::admin()`，与 gateway / billing 运维面同形
    /// （避免空前缀 scope 并列导致 ResourceMap 只进先命中节点）。
    pub fn configure_admin(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/admin/tenants")
                .wrap(Auth::admin())
                .route("", web::get().to(AdminTenantController::toList))
                .route("", web::post().to(AdminTenantController::toWrite))
                .route("/{id}", web::get().to(AdminTenantController::toRead))
                .route("/{id}", web::put().to(AdminTenantController::toUpdate))
                .route("/{id}", web::delete().to(AdminTenantController::toRemove))
                .route("/{id}/members", web::get().to(AdminTenantController::members))
                .route(
                    "/{id}/members",
                    web::post().to(AdminTenantController::member_add),
                )
                .route(
                    "/{id}/members/{userID}",
                    web::put().to(AdminTenantController::member_update),
                )
                .route(
                    "/{id}/members/{userID}",
                    web::delete().to(AdminTenantController::member_remove),
                )
                .route(
                    "/{id}/subscriptions",
                    web::get().to(AdminTenantController::subscriptions),
                )
                .route(
                    "/{id}/subscriptions",
                    web::post().to(AdminTenantController::subscription_grant),
                )
                .route("/{id}/quota", web::get().to(AdminTenantController::quota)),
        );
    }
}
