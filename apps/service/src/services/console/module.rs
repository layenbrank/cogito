use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::console::controller::ConsoleController;

pub struct ConsoleModule;

impl ConsoleModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/console")
                .wrap(Auth::admin())
                .route("/preference", web::get().to(ConsoleController::toRead))
                .route("/preference", web::put().to(ConsoleController::toUpdate)),
        );
    }
}
