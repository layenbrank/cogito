use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::exception::controller::ExceptionController;

/// 异常上报与运维查询。
///
/// - `POST /exception`：可匿名（`public.rs` 白名单）；有 Bearer 则记 Session userID
/// - 其余管理路由：逐条 `Auth::admin()`（与 billing 运维面同形）
pub struct ExceptionModule;

impl ExceptionModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        // POST 可匿名（public 白名单）；GET 列表在 handler 内再验 ADMIN（同 path 合并注册，避免覆盖）
        cfg.service(
            web::resource("/exception")
                .wrap(Auth::isRequired())
                .route(web::post().to(ExceptionController::toWrite))
                .route(web::get().to(ExceptionController::toList)),
        );

        // 管理面：静态子路径须在 /{id} 之前
        cfg.service(
            web::resource("/exception/groups")
                .wrap(Auth::admin())
                .route(web::get().to(ExceptionController::groups)),
        );
        cfg.service(
            web::resource("/exception/sources")
                .wrap(Auth::admin())
                .route(web::get().to(ExceptionController::sources)),
        );
        cfg.service(
            web::resource("/exception/summary")
                .wrap(Auth::admin())
                .route(web::get().to(ExceptionController::summary)),
        );
        cfg.service(
            web::resource("/exception/{id}")
                .wrap(Auth::admin())
                .route(web::get().to(ExceptionController::toRead))
                .route(web::delete().to(ExceptionController::toRemove)),
        );
    }
}
