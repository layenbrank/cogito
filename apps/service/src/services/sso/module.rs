use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::sso::controller::SsoController;

pub struct SsoModule;

impl SsoModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/sso")
                // 后台连接管理（平台 ADMIN）
                .configure(admin_routes)
                // OIDC 流程（公开）
                .route("/{id}/authorize", web::get().to(SsoController::authorize))
                .route("/{id}/callback", web::get().to(SsoController::callback)),
        );
    }
}

/// 管理面路由：要求平台 ADMIN 角色。
///
/// 逐条按 `web::resource` 注册，而不是套一层 `web::scope("")`：同一层级出现空前缀
/// scope 时 actix 的 `ResourceMap` 只在第一个匹配节点内继续查找，后续注册的
/// `/{id}/authorize`、`/{id}/callback` 永远不会被命中（公开的 OIDC 入口曾因此 401）。
fn admin_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::resource("/connections")
            .wrap(Auth::admin())
            .route(web::get().to(SsoController::connections))
            .route(web::post().to(SsoController::connection_write)),
    )
    .service(
        web::resource("/connections/{id}")
            .wrap(Auth::admin())
            .route(web::put().to(SsoController::connection_update))
            .route(web::delete().to(SsoController::connection_remove)),
    );
}
