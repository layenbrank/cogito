//! 平台运维面：`/api/v1/admin/tenants`。
//!
//! 与 `/tenants`（「我的租户」）刻意分开：本面挂 `Auth::admin()` + 列表走
//! [`PlatformScope`]（`BYPASSRLS`）；单租户读写仍经 [`TenantCtx::enter`]，
//! 平台 ADMIN 旁路成员关系的语义与租户面一致并写在 README。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::{TenantId, UserId};

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::subscription::schema::SubscribeP;
use crate::services::tenant::schema::{
    AdminTenantQueryP, MemberUpdateP, MemberWriteP, TenantUpdateP, TenantWriteP,
};
use crate::services::tenant::service::TenantService;
use crate::utils::code::external;

pub struct AdminTenantController;

impl AdminTenantController {
    /// 全平台租户分页列表。
    pub async fn toList(
        db: web::Data<Arc<Storage>>,
        query: web::Query<AdminTenantQueryP>,
    ) -> Result<HttpResponse> {
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = TenantService::admin_list(&scope, query.into_inner()).await;
        platform_read(scope, result, |page| {
            Envelope::success(page, "获取租户列表成功").transform()
        })
        .await
    }

    /// 创建租户（运维面；创建者成为 OWNER，与租户面 POST 同语义）。
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

    /// 租户详情聚合。
    pub async fn toRead(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::admin_detail(&ctx, &config, &redis).await {
            Ok(item) => {
                // list 可能惰性标 EXPIRED，须提交
                ctx.commit().await?;
                Envelope::success(item, "获取租户详情成功").transform()
            }
            Err(err) => {
                let _ = ctx.rollback().await;
                err.transform()
            }
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

    pub async fn subscriptions(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::admin_list_subscriptions(&ctx).await {
            Ok(items) => {
                ctx.commit().await?;
                Envelope::success(items, "获取订阅列表成功").transform()
            }
            Err(err) => {
                let _ = ctx.rollback().await;
                err.transform()
            }
        }
    }

    pub async fn subscription_grant(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<SubscribeP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::admin_grant_subscription(&ctx, &config, &redis, req.into_inner()).await
        {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::write(item).transform()
            }
            Err(err) => {
                let _ = ctx.rollback().await;
                err.transform()
            }
        }
    }

    pub async fn quota(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match TenantService::admin_quota(&ctx, &config, &redis).await {
            Ok(item) => Envelope::success(item, "获取当前配额成功").transform(),
            Err(err) => err.transform(),
        }
    }
}

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

async fn enter(db: &Storage, session: &Session, tenant_raw: &str) -> Result<TenantCtx, Exception> {
    let tenant = tenant_raw
        .parse::<TenantId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))?;

    TenantCtx::enter(db, session, tenant).await
}

fn parse_user_id(value: &str) -> Result<UserId, Exception> {
    value
        .parse::<UserId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "admin tenant scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}

async fn platform_read<T, E, F>(
    scope: PlatformScope,
    result: std::result::Result<T, E>,
    ok: F,
) -> Result<HttpResponse>
where
    E: Into<Exception>,
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
            err.into().transform()
        }
    }
}
