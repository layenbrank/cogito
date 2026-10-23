use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::session::Session;
use crate::interceptors::envelope::Envelope;
use crate::services::sso::schema::{SsoCallbackP, SsoConnectionUpdateP, SsoConnectionWriteP};
use crate::services::sso::service::{SsoError, SsoService};
use crate::utils::code::external;

pub struct SsoController;

impl SsoController {
    // ---- 后台连接 CRUD ----
    //
    // 这里是**平台运维面**（路由上挂着 `Auth::admin()`）：连接按租户隔离，但运维要跨租户看，
    // 建连接时也由平台管理员指定 `tenantID`。因此四个 handler 都在确权之后显式开
    // [`PlatformScope`]——特权只跟着这几个事务走。

    pub async fn connections(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
    ) -> Result<HttpResponse> {
        let _ = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = SsoService::list_connections(&scope).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取 SSO 连接列表成功").transform()
        })
        .await
    }

    pub async fn connection_write(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        req: web::Json<SsoConnectionWriteP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = SsoService::create_connection(&scope, &config, actor, req.into_inner()).await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn connection_update(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<SsoConnectionUpdateP>,
    ) -> Result<HttpResponse> {
        let actor = actor(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            SsoService::update_connection(&scope, &config, actor, id, req.into_inner()).await;
        platform_write(scope, result, |item| {
            Envelope::success(item, "更新 SSO 连接成功").transform()
        })
        .await
    }

    pub async fn connection_remove(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let _ = actor(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = SsoService::delete_connection(&scope, id).await;
        platform_write(scope, result, |()| {
            Envelope::message_only("删除 SSO 连接成功").transform()
        })
        .await
    }

    // ---- OIDC 流程 ----
    //
    // 这两个端点匿名可达（见 [`crate::guards::public`]）：没有会话，作用域由
    // [`crate::guards::sso`] 用回调地址里的连接 id 引导出来，所以 handler 只做参数解析。

    pub async fn authorize(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let id = parse_id(&path.into_inner())?;
        match SsoService::authorize(&db, &redis, id).await {
            Ok(url) => Ok(HttpResponse::Found()
                .append_header(("Location", url))
                .finish()),
            Err(e) => Exception::from(e).transform(),
        }
    }

    pub async fn callback(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        path: web::Path<String>,
        query: web::Query<SsoCallbackP>,
    ) -> Result<HttpResponse> {
        let id = parse_id(&path.into_inner())?;
        let query = query.into_inner();
        match SsoService::callback(&db, &redis, &config, id, &query.code, &query.state).await {
            Ok(item) => Envelope::success(item, "登录成功").transform(),
            Err(e) => Exception::from(e).transform(),
        }
    }
}

/// 只读处理：成功先归还事务再出响应；失败尽力回滚（回滚失败也不能盖掉原始错误）。
async fn platform_read<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, SsoError>,
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

/// 写入处理：**先提交再出响应**，提交失败绝不回 200（否则前端会以为写成功了）。
async fn platform_write<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, SsoError>,
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

fn parse_id(value: &str) -> Result<Uuid, Exception> {
    Uuid::parse_str(value).map_err(|_| Exception::bad_request("ID 格式无效"))
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "sso scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
