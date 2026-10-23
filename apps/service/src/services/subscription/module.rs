use actix_web::web;

use crate::services::subscription::controller::SubscriptionController;

/// 订阅 / 配额路由，由 `TenantModule` 的 `/tenants` scope 通过 `configure` 挂载。
///
/// 这里只注册**相对 `/tenants` 的 `web::resource`**，不再自建 `web::scope("/tenants/{id}/…")`：
/// 与 `TenantModule` 的 `/tenants` 前缀 scope 同层并列时，actix 的 `ResourceMap` 只会进入
/// 先命中的前缀节点，兄弟 scope 永远不被查找 —— 整片路由会 404（订阅与配额接口曾因此全挂，
/// 直接阻断「档位 → 订阅 → 配额变化」闭环）。鉴权由父级 `/tenants` scope 的
/// `Auth::isRequired()` 统一提供，与 `gateway`/`sso` 管理面同一套修法。
pub struct SubscriptionModule;

impl SubscriptionModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::resource("/{id}/subscriptions")
                .route(web::get().to(SubscriptionController::toList))
                .route(web::post().to(SubscriptionController::toWrite)),
        )
        .service(
            web::resource("/{id}/subscriptions/{subscriptionID}")
                .route(web::delete().to(SubscriptionController::toRemove)),
        )
        // 当前生效配额（免费档 / 订阅档位 / 全局兜底）
        .service(web::resource("/{id}/quota").route(web::get().to(SubscriptionController::quota)));
    }
}
