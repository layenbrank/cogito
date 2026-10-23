use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::upload::controller::UploadController;

pub struct UploadModule;

impl UploadModule {
    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/upload")
                .wrap(Auth::isRequired())
                .route("/prepare", web::post().to(UploadController::prepare))
                .route("/hash", web::patch().to(UploadController::bind_hash))
                .route("/chunk", web::post().to(UploadController::chunk))
                .route("/finalize", web::post().to(UploadController::finalize))
                .route("/progress/{id}", web::get().to(UploadController::progress))
                .route("/cancel/{id}", web::delete().to(UploadController::cancel))
                .route("/files", web::get().to(UploadController::toRead_files))
                .route("/files/{hash}", web::get().to(UploadController::serve_file))
                .route("/asset/{id}", web::get().to(UploadController::serve_asset)),
        );
    }
}
