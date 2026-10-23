use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::engine::controller::EngineController;

pub struct EngineModule;

impl EngineModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/engine")
                .wrap(Auth::isRequired())
                .route("/suggestion", web::get().to(EngineController::toRead)),
        );
    }
}
