use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::dict::controller::DictController;

/// 产品状态字典路由。
///
/// 必须用逐条 `web::resource`（与 exception / billing 运维面同形）：
/// 两个同前缀 `scope("/dict")` 并列时，ResourceMap 只进先命中节点——
/// 已登录请求会在仅有 `GET ""` 的那个 scope 里拿不到 `/types`，直接 404。
pub struct DictModule;

impl DictModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        // 成员：当前租户合并目录
        cfg.service(
            web::resource("/dict")
                .wrap(Auth::isRequired())
                .route(web::get().to(DictController::findCatalog)),
        );

        // 平台 ADMIN：类型 / 全局池 / 认领 / 租户覆盖
        cfg.service(
            web::resource("/dict/types")
                .wrap(Auth::admin())
                .route(web::get().to(DictController::findTypes))
                .route(web::post().to(DictController::createType)),
        );
        cfg.service(
            web::resource("/dict/types/{code}")
                .wrap(Auth::admin())
                .route(web::put().to(DictController::updateType)),
        );
        cfg.service(
            web::resource("/dict/items")
                .wrap(Auth::admin())
                .route(web::get().to(DictController::findItems)),
        );
        cfg.service(
            web::resource("/dict/items/allocate")
                .wrap(Auth::admin())
                .route(web::post().to(DictController::allocateItem)),
        );
        // 更具体的 allocate 已在上；`/{value}` 在其后注册
        cfg.service(
            web::resource("/dict/items/{value}")
                .wrap(Auth::admin())
                .route(web::put().to(DictController::updateItem)),
        );
        cfg.service(
            web::resource("/dict/types/{code}/claims")
                .wrap(Auth::admin())
                .route(web::post().to(DictController::claimItems)),
        );
        cfg.service(
            web::resource("/dict/types/{code}/claims/{value}")
                .wrap(Auth::admin())
                .route(web::delete().to(DictController::removeClaim)),
        );
        cfg.service(
            web::resource("/dict/tenants/{tenantId}/items")
                .wrap(Auth::admin())
                .route(web::put().to(DictController::upsertTenantItems)),
        );
        cfg.service(
            web::resource("/dict/tenants/{tenantId}")
                .wrap(Auth::admin())
                .route(web::get().to(DictController::findTenantView)),
        );
    }
}
