use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use authz::{Action, Permission, Resource, require};
use uuid::Uuid;

use crate::configures::configure::Configure;
use crate::created;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::session::Session;
use crate::interceptors::envelope::Envelope;
use crate::no_content;
use crate::services::exception::schema::{QueryP, WriteP};
use crate::services::exception::service::{ExceptionService, ReportError};
use crate::utils::code::{auth as auth_codes, external};

pub struct ExceptionController;

impl ExceptionController {
    /// 客户端上报：可匿名；有 Bearer 时注入 Session 并回填 userID。
    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        body: web::Json<WriteP>,
    ) -> Result<HttpResponse> {
        let session_user = Session::of(&http).map(|session| session.user_id().as_uuid());
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            ExceptionService::toWrite(&scope, body.into_inner(), session_user, &config.app.env)
                .await;
        platform_write(scope, result, |item| created!(item)).await
    }

    pub async fn toList(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<QueryP>,
    ) -> Result<HttpResponse> {
        require_admin(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ExceptionService::toList(&scope, query.into_inner()).await;
        platform_read(scope, result, |page| {
            Envelope::success(page, "获取异常列表成功").transform()
        })
        .await
    }

    pub async fn toRead(
        db: web::Data<Arc<Storage>>,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let id = parse_id(&path)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ExceptionService::toRead(&scope, id).await;
        platform_read(scope, result, |item| {
            Envelope::success(item, "获取异常详情成功").transform()
        })
        .await
    }

    pub async fn toRemove(
        db: web::Data<Arc<Storage>>,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let id = parse_id(&path)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ExceptionService::toRemove(&scope, id).await;
        platform_write(scope, result, |()| no_content!("删除成功")).await
    }

    pub async fn groups(
        db: web::Data<Arc<Storage>>,
        query: web::Query<QueryP>,
    ) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ExceptionService::groups(&scope, query.into_inner()).await;
        platform_read(scope, result, |page| {
            Envelope::success(page, "获取异常分组成功").transform()
        })
        .await
    }

    pub async fn sources(db: web::Data<Arc<Storage>>) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ExceptionService::sources(&scope).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取异常来源成功").transform()
        })
        .await
    }

    pub async fn summary(
        db: web::Data<Arc<Storage>>,
        query: web::Query<QueryP>,
    ) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = ExceptionService::summary(&scope, query.into_inner()).await;
        platform_read(scope, result, |summary| {
            Envelope::success(summary, "获取异常汇总成功").transform()
        })
        .await
    }
}

async fn platform_read<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, ReportError>,
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
    result: std::result::Result<T, ReportError>,
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

/// 与 `Auth::admin()` 同一权限：平台 Account.Manage。
fn require_admin(http: &HttpRequest) -> Result<(), Exception> {
    let session = Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))?;
    require(
        &session.principal(),
        Permission::new(Resource::Account, Action::Manage),
    )
    .map_err(|_| Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "权限不足"))
}

fn parse_id(raw: &str) -> Result<Uuid, Exception> {
    Uuid::parse_str(raw).map_err(|_| {
        Exception::custom(
            crate::utils::code::request::INVALID_PARAMETER_VALUE,
            "id 必须是合法 UUID",
        )
    })
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "exception scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
