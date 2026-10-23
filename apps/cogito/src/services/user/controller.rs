use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::UserId;

use crate::configures::configure::Configure;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::interceptors::envelope::Envelope;
use crate::services::tenant::service::TenantService;
use crate::utils::code::external;
use crate::{
    databases::database::Storage,
    services::user::{
        schema::{UpdateP, WriteP},
        service::{ReadR, UserService},
    },
};

pub struct UserController;

impl UserController {
    pub async fn toRead(db: web::Data<Arc<Storage>>, req: HttpRequest) -> Result<HttpResponse> {
        let id = req.match_info().get("id");
        match UserService::toRead(&db, id).await {
            Ok(ReadR::One(user)) => Envelope::success(user, "获取用户成功").transform(),
            Ok(ReadR::Many(users)) => Envelope::success(users, "获取用户列表成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 用户所属租户联查（平台 ADMIN + PlatformScope）。
    pub async fn tenants(
        db: web::Data<Arc<Storage>>,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let user = path
            .into_inner()
            .parse::<UserId>()
            .map_err(|_| Exception::bad_request("用户 ID 无效"))?;
        let scope = PlatformScope::open(&db).await.map_err(|err| {
            tracing::error!(error = %err, "platform scope open failed");
            Exception::custom(external::DATABASE_ERROR, "数据库错误")
        })?;

        match TenantService::admin_tenants_of_user(&scope, user).await {
            Ok(items) => {
                scope.rollback().await.map_err(|err| {
                    tracing::error!(error = %err, "platform scope rollback failed");
                    Exception::custom(external::DATABASE_ERROR, "数据库错误")
                })?;
                Envelope::success(items, "获取用户所属租户成功").transform()
            }
            Err(err) => {
                let _ = scope.rollback().await;
                Exception::from(err).transform()
            }
        }
    }

    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        req_body: web::Json<WriteP>,
    ) -> Result<HttpResponse> {
        match UserService::toWrite(&db, &config, req_body.into_inner()).await {
            Ok(user) => Envelope::write(user).transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn toUpdate(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        path: web::Path<String>,
        req_body: web::Json<UpdateP>,
    ) -> Result<HttpResponse> {
        let id = path.into_inner();
        match UserService::toUpdate(&db, &config, &id, req_body.into_inner()).await {
            Ok(user) => Envelope::success(user, "更新用户成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn toRemove(
        db: web::Data<Arc<Storage>>,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let id = path.into_inner();
        match UserService::toRemove(&db, &id).await {
            Ok(()) => Envelope::message_only("删除用户成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }
}
