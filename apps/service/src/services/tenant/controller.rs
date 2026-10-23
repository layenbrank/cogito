//! `/tenants` 的 HTTP 入口。
//!
//! 每个 Handler 只做三件事：取会话、进入作用域（[`TenantCtx`]，没选租户的用 [`AccountScope`]）、把结果交给信封。
//! 权限判定不在这一层，业务也不在这一层。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::{TenantId, UserId};

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::account::AccountScope;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::tenant::schema::{MemberUpdateP, MemberWriteP, TenantUpdateP, TenantWriteP};
use crate::services::tenant::service::TenantService;
use crate::utils::code::external;

pub struct TenantController;

impl TenantController {
    /// 我参与的有效成员关系覆盖到的租户；账号级，不需要选定租户。
    pub async fn toList(db: web::Data<Arc<Storage>>, http: HttpRequest) -> Result<HttpResponse> {
        let session = session(&http)?;
        let scope = AccountScope::enter(&db, &session).await?;
        let listed = TenantService::list(&scope).await;
        // 只读请求：当场回滚，连接立即归还。
        scope.rollback().await.map_err(db_error)?;

        match listed {
            Ok(items) => Envelope::success(items, "获取租户列表成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 新建租户：作用域先指向新标识，调用者随成为它的 Owner。
    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<TenantWriteP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = TenantCtx::open_new(&db, &session, TenantId::generate()).await?;

        match TenantService::create(&ctx, req.into_inner()).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::write(item).transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn toRead_by_id(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::get(&ctx).await {
            Ok(item) => Envelope::success(item, "获取租户成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn toUpdate(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<TenantUpdateP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::update(&ctx, req.into_inner()).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::success(item, "更新租户成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn toRemove(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::remove(&ctx).await {
            Ok(()) => {
                ctx.commit().await?;
                Envelope::message_only("删除租户成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn members(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::list_members(&ctx).await {
            Ok(items) => Envelope::success(items, "获取成员列表成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn member_add(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<MemberWriteP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::add_member(&ctx, req.into_inner()).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::write(item).transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn member_update(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<(String, String)>,
        req: web::Json<MemberUpdateP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let (tenant_raw, member_raw) = path.into_inner();
        let ctx = enter(&db, &session, &tenant_raw).await?;
        let member = parse_user_id(&member_raw)?;

        match TenantService::update_member(&ctx, member, req.into_inner()).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::success(item, "更新成员成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn member_remove(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<(String, String)>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let (tenant_raw, member_raw) = path.into_inner();
        let ctx = enter(&db, &session, &tenant_raw).await?;
        let member = parse_user_id(&member_raw)?;

        match TenantService::remove_member(&ctx, member).await {
            Ok(()) => {
                ctx.commit().await?;
                Envelope::message_only("移除成员成功").transform()
            }
            Err(err) => Exception::from(err).transform(),
        }
    }
}

/// 已确认的请求会话；未认证即 401。
fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

/// 进入路径上的租户作用域（内含「是不是成员」的判定）。
async fn enter(db: &Storage, session: &Session, tenant_raw: &str) -> Result<TenantCtx, Exception> {
    let tenant = tenant_raw
        .parse::<TenantId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))?;

    TenantCtx::enter(db, session, tenant).await
}

/// 路径里的成员账号标识。
fn parse_user_id(value: &str) -> Result<UserId, Exception> {
    value
        .parse::<UserId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))
}

/// 数据库错误：日志留因，响应只给码。
fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "tenant scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
