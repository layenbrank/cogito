//! MCP 域路由。
//!
//! 资源用**相对路径**注册（`""` 而不是 `/api/v1/mcp`）：绝对路径写在这里，上层 scope 改
//! 前缀时这一份不会跟着动，路由就静默搬到别处去了。前缀只由 `ApplicationModule` 的
//! `/api/v1` 决定。

use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::mcp::controller::McpController;

pub struct McpModule;

impl McpModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/mcp")
                .wrap(Auth::isRequired())
                .service(web::resource("").route(web::post().to(McpController::toWrite))),
        );
    }
}
