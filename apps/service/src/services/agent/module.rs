//! agent 域路由。
//!
//! 资源用**相对路径**注册（`"/tasks"` 而不是 `"/api/v1/agent/tasks"`）：绝对路径写在这里，
//! 上层 scope 改前缀时这一份不会跟着动，路由就静默搬到别处去了。前缀只由
//! `ApplicationModule` 的 `/api/v1` 决定。

use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::agent::controller::AgentController;

pub struct AgentModule;

impl AgentModule {
    /// 平台运维列表，与租户面 `/agent` 分开，避免 `Auth::isRequired` 吃掉 ADMIN 路由。
    pub fn configure_admin(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::resource("/admin/agent/tasks")
                .wrap(Auth::admin())
                .route(web::get().to(AgentController::admin_list)),
        );
    }

    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/agent")
                .wrap(Auth::isRequired())
                .service(web::resource("/tasks").route(web::post().to(AgentController::toWrite)))
                .service(web::resource("/tasks/{id}").route(web::get().to(AgentController::toRead)))
                .service(
                    web::resource("/tasks/{id}/approvals/{approvalID}")
                        .route(web::post().to(AgentController::toDecide)),
                ),
        );
    }
}
