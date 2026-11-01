use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::TenantId;
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::dict::schema::{
    ClaimP, ItemAllocateP, ItemUpdateP, TenantItemP, TypeP, TypeUpdateP,
};
use crate::services::dict::service::{DictError, DictService};
use crate::utils::code::{external, request};

pub struct DictController;

impl DictController {
    pub async fn findTypes(
        db: web::Data<Arc<Storage>>,
        _http: HttpRequest,
    ) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::findTypes(&scope).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取字典类型成功").transform()
        })
        .await
    }

    pub async fn createType(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        body: web::Json<TypeP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::createType(&scope, actor, body.into_inner()).await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn updateType(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        body: web::Json<TypeUpdateP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            DictService::updateType(&scope, actor, &path.into_inner(), body.into_inner()).await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn findItems(
        db: web::Data<Arc<Storage>>,
        _http: HttpRequest,
    ) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::findItems(&scope).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取字典池成功").transform()
        })
        .await
    }

    pub async fn allocateItem(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        body: web::Json<ItemAllocateP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::allocateItem(&scope, actor, body.into_inner()).await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn updateItem(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        body: web::Json<ItemUpdateP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            DictService::updateItem(&scope, actor, &path.into_inner(), body.into_inner()).await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn claimItems(
        db: web::Data<Arc<Storage>>,
        _http: HttpRequest,
        path: web::Path<String>,
        body: web::Json<Vec<ClaimP>>,
    ) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            DictService::claimItems(&scope, &path.into_inner(), body.into_inner()).await;
        platform_write(scope, result, |items| Envelope::write(items).transform()).await
    }

    pub async fn removeClaim(
        db: web::Data<Arc<Storage>>,
        _http: HttpRequest,
        path: web::Path<(String, String)>,
    ) -> Result<HttpResponse> {
        let (code, value) = path.into_inner();
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::removeClaim(&scope, &code, &value).await;
        platform_write(scope, result, |_| Envelope::write(()).transform()).await
    }

    pub async fn upsertTenantItems(
        db: web::Data<Arc<Storage>>,
        _http: HttpRequest,
        path: web::Path<String>,
        body: web::Json<Vec<TenantItemP>>,
    ) -> Result<HttpResponse> {
        let tenant_id = parse_tenant_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::upsertTenantItems(&scope, tenant_id, body.into_inner()).await;
        platform_write(scope, result, |_| Envelope::write(()).transform()).await
    }

    pub async fn findTenantView(
        db: web::Data<Arc<Storage>>,
        _http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let tenant_id = parse_tenant_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = DictService::findTenantView(&scope, tenant_id).await;
        platform_read(scope, result, |view| Envelope::write(view).transform()).await
    }

    pub async fn findCatalog(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &http).await?;
        let tenant_id = ctx.tenant_id();
        let result = DictService::findCatalog(&db, tenant_id).await;
        ctx.rollback().await?;
        match result {
            Ok(catalog) => Envelope::write(catalog).transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }
}

async fn platform_read<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, DictError>,
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
    result: std::result::Result<T, DictError>,
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

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

async fn enter(
    db: &Storage,
    session: &Session,
    http: &HttpRequest,
) -> Result<TenantCtx, Exception> {
    TenantCtx::enter(db, session, tenant_of(http)?).await
}

fn tenant_of(http: &HttpRequest) -> Result<TenantId, Exception> {
    let raw = http
        .headers()
        .get("X-Tenant-ID")
        .ok_or_else(|| Exception::custom(request::MISSING_PARAMETER, "缺少 X-Tenant-ID 请求头"))?;

    raw.to_str()
        .ok()
        .and_then(|value| value.trim().parse::<TenantId>().ok())
        .ok_or_else(|| Exception::custom(request::INVALID_HEADER, "X-Tenant-ID 格式无效"))
}

fn parse_tenant_id(raw: &str) -> Result<TenantId, Exception> {
    raw.trim()
        .parse::<TenantId>()
        .map_err(|_| Exception::custom(request::INVALID_PARAMETER_VALUE, "tenantId 格式无效"))
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "dict scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
