//! 定时任务域路由（`/api/v1/automations`）。
//!
//! 资源用**相对路径**注册：前缀只由 `ApplicationModule` 的 `/api/v1` 决定，
//! 上层改前缀时这一份跟着走，不会静默搬到别处。

use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::schedule::controller::ScheduleController;

pub struct ScheduleModule;

impl ScheduleModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/automations")
                .wrap(Auth::isRequired())
                .service(
                    web::resource("")
                        .route(web::get().to(ScheduleController::toList))
                        .route(web::post().to(ScheduleController::toSave)),
                )
                .service(
                    web::resource("/{id}")
                        .route(web::patch().to(ScheduleController::toPatch))
                        .route(web::delete().to(ScheduleController::toRemove)),
                ),
        );
    }
}
