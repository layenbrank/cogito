use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::session::Session;
use crate::interceptors::envelope::Envelope;
use crate::services::console::schema::PreferenceP;
use crate::services::console::service::{ConsoleError, ConsoleService};
use crate::utils::code::external;

pub struct ConsoleController;

impl ConsoleController {
    pub async fn toRead(db: web::Data<Arc<Storage>>, http: HttpRequest) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ConsoleService::toRead(&scope, actor).await;
        platform_read(scope, result, |item| {
            Envelope::success(item, "获取控制台偏好成功").transform()
        })
        .await
    }

    pub async fn toUpdate(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        body: web::Json<PreferenceP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ConsoleService::toUpdate(&scope, actor, body.into_inner()).await;
        platform_write(scope, result, |item| {
            Envelope::success(item, "更新控制台偏好成功").transform()
        })
        .await
    }
}

async fn platform_read<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, ConsoleError>,
    ok: F,
) -> Result<HttpResponse>
where
    F: FnOnce(T) -> Result<HttpResponse>,
{
    match result {
        Ok(data) => {
            scope.rollback().await.map_err(db_error)?;
            ok(data)
        }
        Err(err) => {
            if let Err(e) = scope.rollback().await {
                tracing::warn!(error = %e, "平台作用域回滚失败");
            }
            Exception::from(err).transform()
        }
    }
}

async fn platform_write<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, ConsoleError>,
    ok: F,
) -> Result<HttpResponse>
where
    F: FnOnce(T) -> Result<HttpResponse>,
{
    match result {
        Ok(data) => {
            scope.commit().await.map_err(db_error)?;
            ok(data)
        }
        Err(err) => {
            if let Err(e) = scope.rollback().await {
                tracing::warn!(error = %e, "平台作用域回滚失败");
            }
            Exception::from(err).transform()
        }
    }
}

fn actor(http: &HttpRequest) -> Result<Uuid, Exception> {
    let session = Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))?;
    Ok(session.user_id().as_uuid())
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "console scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
