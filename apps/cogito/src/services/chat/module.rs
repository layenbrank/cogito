//! 会话同步域路由。
//!
//! 资源用**相对路径**注册（`"/sync"` 而不是 `"/api/v1/chat/sync"`）：绝对路径写在这里，
//! 上层 scope 改前缀时这一份不会跟着动，路由就静默搬到别处去了。前缀只由 `ApplicationModule`
//! 的 `/api/v1` 决定。
//!
//! 同一个资源两种方法：`POST` 推一批、`GET` 拉增量。两者共用「水位」这一份状态，放在同一个
//! 路径下比编两个名字（`/sync` 与 `/changes`）更诚实——客户端面对的就是一条流。

use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::chat::controller::ChatController;

pub struct ChatModule;

impl ChatModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/chat")
                .wrap(Auth::isRequired())
                .service(
                    web::resource("/sync")
                        .route(web::post().to(ChatController::toWrite))
                        .route(web::get().to(ChatController::toRead)),
                ),
        );
    }
}
