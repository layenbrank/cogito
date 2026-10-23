//! rag 索引任务域路由。
//!
//! 资源用**相对路径**注册（`"/index-tasks"` 而不是 `"/api/v1/rag/index-tasks"`）：绝对路径
//! 写在这里，上层 scope 改前缀时这一份不会跟着动，路由就静默搬到别处去了。前缀只由
//! `ApplicationModule` 的 `/api/v1` 决定。

use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::rag::controller::IndexController;

pub struct RagModule;

impl RagModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/rag")
                .wrap(Auth::isRequired())
                .service(
                    web::resource("/index-tasks").route(web::post().to(IndexController::toWrite)),
                )
                .service(
                    web::resource("/index-tasks/{id}")
                        .route(web::get().to(IndexController::toRead)),
                ),
        );
    }
}
