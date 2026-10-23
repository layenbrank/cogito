use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::user::controller::UserController;

pub struct UserModule;

impl UserModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/users")
                .wrap(Auth::admin())
                .route("", web::get().to(UserController::toRead))
                .route("", web::post().to(UserController::toWrite))
                .route("/{id}", web::get().to(UserController::toRead))
                .route("/{id}", web::put().to(UserController::toUpdate))
                .route("/{id}", web::delete().to(UserController::toRemove))
                // 所属租户联查：须注册在 /{id} 同级更具体路径（actix 按 resource 匹配）
                .route("/{id}/tenants", web::get().to(UserController::tenants)),
        );
    }
}
