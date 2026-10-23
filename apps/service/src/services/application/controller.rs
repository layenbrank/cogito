use std::sync::Arc;

use actix_web::{Responder, web};

use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::interceptors::envelope::Envelope;
use crate::services::application::{schema::App, service::ApplicationService};

pub struct ApplicationController;

impl ApplicationController {
    pub async fn toRead(
        _storage: web::Data<Arc<Storage>>,
        _config: web::Data<Arc<Configure>>,
        _req: web::Json<App>,
    ) -> impl Responder {
        match ApplicationService::toRead().await {
            Ok(app) => Envelope::success(app, "获取应用成功").transform(),
            Err(e) => Exception::from(e).transform(),
        }
    }

    pub async fn toUpdate(
        _storage: web::Data<Arc<Storage>>,
        _config: web::Data<Arc<Configure>>,
        _req: web::Json<App>,
    ) -> impl Responder {
        match ApplicationService::toRead().await {
            Ok(app) => Envelope::success(app, "更新应用成功").transform(),
            Err(e) => Exception::from(e).transform(),
        }
    }
}
