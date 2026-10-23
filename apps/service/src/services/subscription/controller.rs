//! 订阅接口层：每个 Handler 只做三件事：取会话、进入租户作用域（[`TenantCtx`]）、把结果交给信封。
//! 权限判定在领域层由 `authz` 完成，这里不再自己比角色。

use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};
use identity::TenantId;
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Envelope;
use crate::services::subscription::schema::SubscribeP;
use crate::services::subscription::service::SubscriptionService;

pub struct SubscriptionController;

impl SubscriptionController {
    /// 租户订阅历史（含已取消 / 已到期）。
    ///
    /// 领域层会顺手把过期订阅标为 EXPIRED，所以读路径也要提交。
    pub async fn toList(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match SubscriptionService::list(&ctx).await {
            Ok(items) => {
                ctx.commit().await?;
                Envelope::success(items, "获取订阅列表成功").transform()
            }
            Err(err) => err.transform(),
        }
    }

    /// 开通 / 续订：重复调用即续订（旧订阅作废）。
    pub async fn toWrite(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<SubscribeP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match SubscriptionService::subscribe(&ctx, &config, &redis, req.into_inner()).await {
            Ok(item) => {
                ctx.commit().await?;
                Envelope::write(item).transform()
            }
            Err(err) => err.transform(),
        }
    }

    /// 取消订阅（立即失效）。
    pub async fn toRemove(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<(String, String)>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let (tenant_id, subscription_id) = path.into_inner();
        let ctx = enter(&db, &session, &tenant_id).await?;
        let subscription_id = parse_id(&subscription_id)?;

        match SubscriptionService::cancel(&ctx, &redis, subscription_id).await {
            Ok(()) => {
                ctx.commit().await?;
                Envelope::message_only("取消订阅成功").transform()
            }
            Err(err) => err.transform(),
        }
    }

    /// 当前生效配额（免费档 / 订阅档位 / 全局兜底）。
    pub async fn quota(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ctx = enter(&db, &session, &path.into_inner()).await?;

        match SubscriptionService::quota(&ctx, &config, &redis).await {
            Ok(item) => Envelope::success(item, "获取当前配额成功").transform(),
            Err(err) => err.transform(),
        }
    }
}

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

/// 进入 `{tenantID}` 指向的租户作用域：非成员在这里就被拒（403）。
async fn enter(db: &Storage, session: &Session, tenant_raw: &str) -> Result<TenantCtx, Exception> {
    let tenant = tenant_raw
        .parse::<TenantId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))?;

    TenantCtx::enter(db, session, tenant).await
}

fn parse_id(value: &str) -> Result<Uuid, Exception> {
    Uuid::parse_str(value).map_err(|_| Exception::bad_request("ID 格式无效"))
}
