//! 网关 HTTP 入口。
//!
//! 每个 handler 的第一件事是**进入作用域**：`X-Tenant-ID` 只是选择器（选了就进租户作用域，
//! 需是成员或平台管理员），没选就落在账号作用域；运维面（供应商/模型/用量/审计）则显式
//! 进入平台特权作用域。作用域在 handler 里显式收尾——只读回滚、写入提交——
//! 领域函数因此永远拿不到「裸连接」。

use std::sync::Arc;

use actix_web::http::header::{ContentDisposition, DispositionParam, DispositionType};
use actix_web::{HttpRequest, HttpResponse, Result, web};
use entity::tenant;
use identity::{Principal, TenantId};
use sea_orm::{DatabaseTransaction, EntityTrait};
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::{Configure, SERVICE_TOKEN_MAX_TTL_SECS};
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::account::AccountScope;
use crate::guards::platform::PlatformScope;
use crate::guards::service::{ChatScope, InternalCaller, ServiceScope};
use crate::guards::session::Session;
use crate::guards::tenant::{TenantCtx, TenantScope};
use crate::interceptors::envelope::{Envelope, Paginated};
use crate::services::agent::error::AgentError;
use crate::services::gateway::client::Upstream;
use crate::services::gateway::render;
use crate::services::gateway::schema::{
    AuditExportFormat, AuditExportP, AuditFilter, AuditQueryP, ChatCompletionsP, EmbeddingsP,
    ModelUpdateP, ModelWriteP, ProviderUpdateP, ProviderWriteP, SelfQuotaP, ServiceTokenP,
    ServiceTokenR, UsageQueryP,
};
use crate::services::gateway::service::{
    AuditExport, GatewayError, GatewayService, Prepared, ServiceCapability,
};
use crate::services::gateway::service_token::{self, Audience};
use crate::services::upload::{repository, schema::Visibility, service::UploadService, validation};
use crate::utils::code::{business, external, system};

pub struct GatewayController;

/// 本次请求作用域：选了租户就进租户作用域，否则账号作用域。
enum Scope {
    Tenant(TenantCtx),
    Account(AccountScope),
}

/// 作用域 + 请求身份：领域函数两者都要，于是打包成一个东西交给它们。
struct Target {
    scope: Scope,
    principal: Principal,
}

impl Target {
    /// 进入本次请求的作用域；`tenant_id` 来自 `X-Tenant-ID`，**它不是通行证**——
    /// 不是成员又不是平台管理员时 `TenantCtx::enter` 直接 403。
    async fn enter(
        db: &Storage,
        session: &Session,
        tenant_id: Option<Uuid>,
    ) -> Result<Self, Exception> {
        match tenant_id {
            Some(tid) => {
                let ctx = TenantCtx::enter(db, session, TenantId::from_uuid(tid)).await?;
                let principal = ctx.principal().clone();
                Ok(Self {
                    scope: Scope::Tenant(ctx),
                    principal,
                })
            }
            None => Ok(Self {
                scope: Scope::Account(AccountScope::enter(db, session).await?),
                principal: session.principal(),
            }),
        }
    }

    fn tx(&self) -> &DatabaseTransaction {
        match &self.scope {
            Scope::Tenant(ctx) => ctx.tx(),
            Scope::Account(scope) => scope.tx(),
        }
    }

    fn principal(&self) -> &Principal {
        &self.principal
    }

    /// 收尾：请求路径上的数据库工作都是只读（写另一段短作用域）或者已由服务层提交，
    /// 于是统一回滚，连接当场归还。
    async fn end(self) -> Result<(), Exception> {
        match self.scope {
            Scope::Tenant(ctx) => ctx.rollback().await,
            Scope::Account(scope) => scope.rollback().await.map_err(db_error),
        }
    }
}

impl GatewayController {
    /// OpenAI 兼容 chat/completions 转发（stream 走 SSE 直传，非 stream 返回原始 JSON）。
    pub async fn chat(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        body: web::Json<ChatCompletionsP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let ip = client_ip(&http);
        let req = body.into_inner();
        let stream = req.stream.unwrap_or(false);
        let upstream = Upstream::new(config.as_ref());

        // 解析在作用域里，上游调用与落库都在作用域之外：一次模型调用可能跑几十秒，
        // 事务绝不能跨越它（否则连接池会被长事务占满）。
        let target = Target::enter(&db, &session, tenant_from_header(&http)).await?;
        let prepared =
            GatewayService::prepare(target.tx(), target.principal(), &config, &redis, &req.model)
                .await;
        target.end().await?;
        let prepared = match prepared {
            Ok(prepared) => prepared,
            Err(err) => return Exception::from(err).transform(),
        };

        if stream {
            let stream = GatewayService::chat_stream(
                db.get_ref().clone(),
                redis.get_ref().clone(),
                config.get_ref().clone(),
                &upstream,
                prepared,
                &req,
                ip,
            )
            .await;
            match stream {
                Ok(s) => Ok(HttpResponse::Ok()
                    .content_type("text/event-stream")
                    .insert_header(("Cache-Control", "no-cache"))
                    .insert_header(("X-Accel-Buffering", "no"))
                    .streaming(s)),
                Err(e) => Exception::from(e).transform(),
            }
        } else {
            match GatewayService::chat_json(&db, &redis, &config, &upstream, prepared, &req, ip)
                .await
            {
                Ok(value) => Ok(HttpResponse::Ok().json(value)),
                Err(e) => Exception::from(e).transform(),
            }
        }
    }

    /// 服务身份出站：申请一枚短期令牌。
    ///
    /// 调用方是受信服务进程（当前只有 compute），用它自己的共享令牌（`X-Internal-Token`）
    /// 换取一枚**带作用域**的短期令牌。作用域有四件事：嵌入出站（租户 + 模型）、资产内容
    /// （租户 + 单个资产）、聊天出站（租户 + 模型）、资产可见性写入（租户 + 单个资产 + 一次
    /// 已批准的审批）；一件事一个受众，令牌串门会在端点侧被拒。
    /// 响应是裸结构而不是信封：取令牌的是机器，出错时才走信封（与 chat 的返回形状口径一致）。
    ///
    /// 这里只校验「租户存在」与「资产在本租户可见且已完成」——模型是否存在、是否具备所需
    /// 能力，由真正出站的那次调用（[`service_embeddings`](Self::service_embeddings) /
    /// [`service_chat`](Self::service_chat)）判定，令牌段不做多余查库。资产那一项必须在这里查：
    /// 令牌一旦签出去就无法收回，不能在签发时放过一个读不到的资产。
    ///
    /// 写令牌还要读一次审批台账，理由相同：**令牌签出去就收不回**，所以「批的是不是这个资产、
    /// 批的人是不是它的创建者、批成什么样」必须在签发这一刻判定完，之后写端点只看令牌。
    pub async fn service_token(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        _caller: InternalCaller,
        body: web::Json<ServiceTokenP>,
    ) -> Result<HttpResponse> {
        let req = body.into_inner();
        let tenant_id = req
            .tenant_id
            .parse::<Uuid>()
            .map(TenantId::from_uuid)
            .map_err(|_| Exception::bad_request("租户ID格式无效"))?;
        let audience = match req.scope.as_deref().map(str::trim) {
            None | Some("") => Audience::Embeddings,
            Some(raw) => match Audience::from_scope(raw) {
                Some(audience) => audience,
                None => {
                    return Exception::bad_request(
                        "scope 仅支持 embeddings / asset-read / chat / asset-write",
                    )
                    .transform();
                }
            },
        };
        // 作用域必填字段按受众判定：嵌入与聊天要模型，两类资产作用域要资产——前者在请求体里，
        // 但真正生效的永远是签名进令牌的那一份。
        let model = match audience {
            Audience::Embeddings | Audience::Chat => {
                let model = req.model.as_deref().unwrap_or_default().trim();
                if model.is_empty() {
                    return Exception::bad_request("model 不能为空").transform();
                }
                Some(model.to_string())
            }
            Audience::AssetContent | Audience::AssetVisibility => None,
        };
        let asset_id = match audience {
            Audience::AssetContent | Audience::AssetVisibility => {
                let asset_id = req.asset_id.as_deref().unwrap_or_default().trim();
                if asset_id.is_empty() {
                    return Exception::bad_request("assetID 不能为空").transform();
                }
                Some(asset_id.to_string())
            }
            Audience::Embeddings | Audience::Chat => None,
        };
        // 写令牌不带一张单子就只是一枚无名写权限：这一项缺失算参数错误（调用方写错了请求），
        // 单子本身对不对是后面查库的事（那算 403）。
        let approval_id = match audience {
            Audience::AssetVisibility => {
                let approval_id = req.approval_id.as_deref().unwrap_or_default().trim();
                if approval_id.is_empty() {
                    return Exception::bad_request("approvalID 不能为空").transform();
                }
                Some(approval_id.to_string())
            }
            Audience::Embeddings | Audience::Chat | Audience::AssetContent => None,
        };
        let scope = TenantScope::open(&db, tenant_id).await.map_err(db_error)?;
        let known = tenant::Entity::find_by_id(tenant_id.as_uuid())
            .one(scope.tx())
            .await;
        // 资产存在性检查复用读内容时的同一处判定，两处口径不会漂移。
        let readable = match (known.as_ref(), asset_id.as_deref()) {
            (Ok(Some(_)), Some(asset_id)) if audience == Audience::AssetContent => {
                Some(UploadService::service_asset_parts(scope.tx(), asset_id).await)
            }
            _ => None,
        };
        // 写令牌的凭据核对也在**即将结束时才回滚的同一个窗口**里做：它要读审批台账与资产的
        // 创建者，两件事都必须按这一租户的行级策略去读（跨租户读到 `None`，等于没批过）。
        let grant = match (known.as_ref(), audience, approval_id.as_deref()) {
            (Ok(Some(_)), Audience::AssetVisibility, Some(approval_id)) => Some(
                Self::approved_visibility_write(
                    scope.tx(),
                    approval_id,
                    asset_id.as_deref().unwrap_or_default(),
                )
                .await,
            ),
            _ => None,
        };
        scope.rollback().await.map_err(db_error)?;
        match known {
            Ok(Some(_)) => {}
            Ok(None) => return Exception::not_found("租户不存在").transform(),
            Err(err) => return db_error(err).transform(),
        }
        if let Some(Err(err)) = readable {
            return Exception::from(err).transform();
        }
        let grant = match grant {
            Some(Ok(grant)) => Some(grant),
            Some(Err(err)) => return err.transform(),
            None => None,
        };

        let secret = config.gateway_service_token_secret();
        if secret.is_empty() {
            return Exception::custom(system::SERVICE_UNAVAILABLE, "服务身份端点未启用")
                .transform();
        }

        let ttl = req
            .ttl_secs
            .unwrap_or_else(|| config.gateway_service_token_ttl_secs())
            .clamp(1, SERVICE_TOKEN_MAX_TTL_SECS);
        let tenant_raw = tenant_id.as_uuid().to_string();
        let token_scope = match (audience, model.as_deref(), asset_id.as_deref()) {
            (Audience::Embeddings, Some(model), _) => service_token::Scope::Embeddings {
                tenant_id: &tenant_raw,
                model,
            },
            (Audience::Chat, Some(model), _) => service_token::Scope::Chat {
                tenant_id: &tenant_raw,
                model,
            },
            (Audience::AssetContent, _, Some(asset_id)) => service_token::Scope::AssetContent {
                tenant_id: &tenant_raw,
                asset_id,
            },
            (Audience::AssetVisibility, _, Some(asset_id)) => {
                let grant = grant.as_ref().expect("写受众的凭据已在上面核对过");
                service_token::Scope::AssetVisibility {
                    tenant_id: &tenant_raw,
                    asset_id,
                    approval_id: &grant.approval_id,
                    actor_id: &grant.actor_id,
                    visibility: grant.visibility.as_str(),
                    viewers: &grant.viewers,
                }
            }
            _ => unreachable!("作用域必填字段已在上面校验"),
        };
        let (token, expires_at) = service_token::mint(secret, token_scope, ttl).map_err(|err| {
            tracing::error!(error = %err, "服务身份令牌签发失败");
            Exception::internal_error("服务身份令牌签发失败")
        })?;

        Ok(HttpResponse::Ok().json(ServiceTokenR {
            token,
            expires_at,
            tenant_id: tenant_raw,
            scope: audience.scope().to_string(),
            model,
            asset_id,
            approval_id,
            token_type: "service".to_string(),
        }))
    }

    /// 把一次审批翻成「可以写这个资产的可见性」的凭据；读不到、不合规一律 403。
    ///
    /// 判定顺序是刻意的：先问「有没有这么一张批准了的单子」，再问「单子上写的是不是这次要做的
    /// 事」，最后问「批的人有没有资格」——每一步不通过都归到同一个业务码
    /// （[`APPROVAL_INVALID`](crate::utils::code::business::agent::APPROVAL_INVALID)），
    /// 具体原因只落日志，免得别的租户能拿它探「某个审批 id 存在过」。
    ///
    /// # Errors
    /// 审批不存在/未批准/没人批、参数原文与资产不符或不可解析、资产不存在、批准人不是资产创建者。
    async fn approved_visibility_write(
        tx: &DatabaseTransaction,
        approval_id: &str,
        asset_id: &str,
    ) -> Result<VisibilityGrant, Exception> {
        let Some(recorded) = agent::persistence::find_approval(tx, approval_id)
            .await
            .map_err(|err| Exception::from(AgentError::from(err)))?
        else {
            return Err(Self::invalid_approval("租户里没有这条审批"));
        };
        if recorded.state != APPROVED_STATE {
            return Err(Self::invalid_approval("审批不是已批准状态"));
        }
        let Some(actor) = recorded.decided_by else {
            return Err(Self::invalid_approval("审批没有记下是谁批的"));
        };

        let arguments = serde_json::from_str::<VisibilityWriteArguments>(&recorded.arguments)
            .map_err(|err| {
                tracing::info!(error = %err, approval_id, "审批参数无法按可见性写入解析");
                Self::invalid_approval("审批参数不是一次可见性写入")
            })?;
        if arguments.asset_id.trim() != asset_id {
            return Err(Self::invalid_approval("审批针对的是另一个资产"));
        }
        let Some(visibility) = Visibility::parse(&arguments.visibility) else {
            return Err(Self::invalid_approval("审批里的可见性字面量不认识"));
        };
        if visibility != Visibility::Restricted && !arguments.viewers.is_empty() {
            // `parse_viewers` 对非 RESTRICTED 会静默丢掉名单——那会写出一个和人批的不一样的
            // 权限，所以这里宁可拒。
            return Err(Self::invalid_approval(
                "审批内容自相矛盾：非 RESTRICTED 却给了名单",
            ));
        }
        let viewers = validation::parse_viewers(visibility.clone(), Some(&arguments.viewers))
            .map(|ids| ids.iter().map(Uuid::to_string).collect::<Vec<_>>())
            .map_err(|err| {
                tracing::info!(error = %err, approval_id, "审批里的可见对象名单不合法");
                Self::invalid_approval("审批里的可见对象名单不合法")
            })?;

        // 资产行的写策略只认创建者，所以「审批人 = 创建者」不是我们的额外规矩，而是唯一能落地
        // 的写法：别人批了也写不进去。查不到（含跨租户）是 404，不承认它存在过。
        let asset = repository::find_by_id(tx, asset_id).await?;
        if asset.creator != Some(actor) {
            return Err(Self::invalid_approval("这次审批不是资产创建者批的"));
        }

        Ok(VisibilityGrant {
            approval_id: approval_id.to_string(),
            actor_id: actor.to_string(),
            visibility,
            viewers,
        })
    }

    /// 审批不能用来写资产时的统一答法（细节留日志）。
    fn invalid_approval(reason: &str) -> Exception {
        tracing::info!(reason, "审批凭据被拒：不能用于资产可见性写入");
        Exception::custom(
            business::agent::APPROVAL_INVALID,
            "这次审批不能用于写入该资产",
        )
    }

    /// 服务身份出站：嵌入转发（模型由令牌作用域决定，不接受客户端指定）。
    pub async fn service_embeddings(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        scope: ServiceScope,
        body: web::Json<EmbeddingsP>,
    ) -> Result<HttpResponse> {
        let req = body.into_inner();
        if let Some(requested) = req.model.as_deref().map(str::trim)
            && !requested.is_empty()
            && requested != scope.model()
        {
            return Exception::bad_request("model 与令牌作用域不一致").transform();
        }

        let ip = client_ip(&http);
        let upstream = Upstream::new(config.as_ref());
        let prepared = prepare_service_call(
            &db,
            &redis,
            &config,
            scope.tenant_id(),
            scope.model(),
            ServiceCapability::Embeddings,
        )
        .await?;

        match GatewayService::embed_json(&db, &redis, &config, &upstream, prepared, &req, ip).await
        {
            Ok(value) => Ok(HttpResponse::Ok().json(value)),
            Err(e) => Exception::from(e).transform(),
        }
    }

    /// 服务身份出站：聊天转发（模型由令牌作用域决定，不接受客户端指定）。
    ///
    /// 转发本身走的是用户面同一个 [`GatewayService::chat_json`]：配额预检、用量与审计记账
    /// **完全共用**，差别只有身份（`SERVICE_ACTOR_ID` + 令牌租户）。这正是「gateway 是唯一
    /// 出网点」这句话的兑现方式——服务调用不可能绕过配额，因为它压根不走别的代码路径。
    ///
    /// 一律非流式：调用方是机器，请求与响应一对一才谈得上活动级重试与幂等键。
    pub async fn service_chat(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        scope: ChatScope,
        body: web::Json<ChatCompletionsP>,
    ) -> Result<HttpResponse> {
        let req = body.into_inner();
        // 真正生效的模型来自令牌；请求体里带了不一致的 model 说明调用方搞错了，
        // 直接报错而不是「悄悄按令牌执行」（与 service_embeddings 同一口径）。
        if req.model.trim() != scope.model() {
            return Exception::bad_request("model 与令牌作用域不一致").transform();
        }

        let ip = client_ip(&http);
        let upstream = Upstream::new(config.as_ref());
        let prepared = prepare_service_call(
            &db,
            &redis,
            &config,
            scope.tenant_id(),
            scope.model(),
            ServiceCapability::Chat,
        )
        .await?;

        match GatewayService::chat_json(&db, &redis, &config, &upstream, prepared, &req, ip).await {
            Ok(value) => Ok(HttpResponse::Ok().json(value)),
            Err(e) => Exception::from(e).transform(),
        }
    }

    pub async fn models(db: web::Data<Arc<Storage>>, http: HttpRequest) -> Result<HttpResponse> {
        let session = session(&http)?;
        let target = Target::enter(&db, &session, tenant_from_header(&http)).await?;
        let result = GatewayService::list_models(target.tx(), target.principal()).await;
        target.end().await?;
        match result {
            Ok(items) => Envelope::success(items, "获取模型列表成功").transform(),
            Err(e) => Exception::from(e).transform(),
        }
    }

    /// 只读自助配额：登录用户查自己（或自己所属租户）此刻的日窗用量与上限。
    pub async fn quota_me(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        query: web::Query<SelfQuotaP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let target = Target::enter(&db, &session, tenant_from_header(&http)).await?;
        let result = GatewayService::self_quota(
            target.tx(),
            target.principal(),
            &config,
            &redis,
            query.model.as_deref(),
        )
        .await;
        target.end().await?;
        match result {
            Ok(data) => Envelope::success(data, "获取配额成功").transform(),
            Err(e) => Exception::from(e).transform(),
        }
    }

    /// 档位目录：可开通档位与免费档基线（登录即可读，用于渲染档位卡）。
    pub async fn plans(
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let data = GatewayService::list_plans(&config);
        Envelope::success(data, "获取档位成功").transform()
    }

    // ---- 后台 provider CRUD ----

    pub async fn providers(db: web::Data<Arc<Storage>>, http: HttpRequest) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::list_providers(&scope).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取供应商列表成功").transform()
        })
        .await
    }

    pub async fn provider_write(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        req: web::Json<ProviderWriteP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::create_provider(
            &scope,
            &config,
            session.user_id().as_uuid(),
            req.into_inner(),
        )
        .await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn provider_update(
        db: web::Data<Arc<Storage>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<ProviderUpdateP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::update_provider(
            &scope,
            &config,
            session.user_id().as_uuid(),
            id,
            req.into_inner(),
        )
        .await;
        platform_write(scope, result, |item| {
            Envelope::success(item, "更新供应商成功").transform()
        })
        .await
    }

    pub async fn provider_remove(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::delete_provider(&scope, id).await;
        platform_write(scope, result, |()| {
            Envelope::message_only("删除供应商成功").transform()
        })
        .await
    }

    // ---- 后台 model CRUD ----

    pub async fn models_admin(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::list_models_admin(&scope).await;
        platform_read(scope, result, |items| {
            Envelope::success(items, "获取模型列表成功").transform()
        })
        .await
    }

    pub async fn model_write(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<ModelWriteP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            GatewayService::create_model(&scope, session.user_id().as_uuid(), req.into_inner())
                .await;
        platform_write(scope, result, |item| Envelope::write(item).transform()).await
    }

    pub async fn model_update(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        req: web::Json<ModelUpdateP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result =
            GatewayService::update_model(&scope, session.user_id().as_uuid(), id, req.into_inner())
                .await;
        platform_write(scope, result, |item| {
            Envelope::success(item, "更新模型成功").transform()
        })
        .await
    }

    pub async fn model_remove(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let id = parse_id(&path.into_inner())?;
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::delete_model(&scope, id).await;
        platform_write(scope, result, |()| {
            Envelope::message_only("删除模型成功").transform()
        })
        .await
    }

    // ---- 用量 / 审计 ----

    pub async fn usage(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<UsageQueryP>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let page = query.page.unwrap_or(1).max(1);
        let size = query.size.unwrap_or(50).clamp(1, 200);
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::list_usage(&scope, query.into_inner())
            .await
            .map(|(items, count)| Paginated::new(items, count, page, size));
        platform_read(scope, result, |paginated| {
            Envelope::success(paginated, "获取用量成功").transform()
        })
        .await
    }

    pub async fn audit(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<AuditQueryP>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        // 过滤条件非法时直接 400：审计是事后追溯入口，「条件写错了却看起来查到了结果」
        // 比多一次报错危险得多（与用量查询的宽容解析有意不同）。
        let filter = match AuditFilter::parse(
            query.tenant_id.as_deref(),
            query.actor.as_deref(),
            query.action.as_deref(),
            query.from,
            query.to,
        ) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let page = query.page.unwrap_or(1).max(1);
        let size = query.size.unwrap_or(50).clamp(1, 200);
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::list_audit(&scope, filter, page, size)
            .await
            .map(|(items, count)| Paginated::new(items, count, page, size));
        platform_read(scope, result, |paginated| {
            Envelope::success(paginated, "获取审计日志成功").transform()
        })
        .await
    }

    /// 审计导出：与列表同一组过滤条件，输出**原始文件字节**而不是 JSON 信封
    /// （`Content-Disposition: attachment`，浏览器直接落盘）。
    ///
    /// 命中 0 行不是 404：窗口内没有事件是合法结果，此时 CSV 只有表头。让空结果报错，
    /// 排查脚本会把「真的没发生」误判成「导出坏了」。
    pub async fn audit_export(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<AuditExportP>,
    ) -> Result<HttpResponse> {
        let _ = session(&http)?;
        let format = query.format.unwrap_or(AuditExportFormat::Csv);
        let filter = match AuditFilter::parse(
            query.tenant_id.as_deref(),
            query.actor.as_deref(),
            query.action.as_deref(),
            query.from,
            query.to,
        ) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let scope = PlatformScope::open(&db).await.map_err(db_error)?;
        let result = GatewayService::export_audit(&scope, filter).await;
        // 渲染交给 platform_read 的回调：它归还事务在前、构造响应在后，
        // 几十万行级别的拼串不会把数据库连接一直占着。
        platform_read(scope, result, |export| Ok(audit_download(format, &export))).await
    }

    // ---- 租户面审计（挂在 `TenantModule` 的 `/tenants` scope 下，见 module.rs）----

    /// 本租户审计列表。租户来自**路径**而不是 `X-Tenant-ID`：审计接口的可见范围不该由
    /// 请求头决定，路径上写明哪个租户、再走一次成员关系判定，读起来没有歧义。
    pub async fn tenant_audit(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        query: web::Query<AuditQueryP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let tenant = parse_tenant(&path.into_inner())?;
        let filter = match AuditFilter::parse_for_tenant(
            tenant,
            query.tenant_id.as_deref(),
            query.actor.as_deref(),
            query.action.as_deref(),
            query.from,
            query.to,
        ) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let page = query.page.unwrap_or(1).max(1);
        let size = query.size.unwrap_or(50).clamp(1, 200);
        // 作用域在过滤条件之后才开：参数写错不该先占一条数据库连接
        let ctx = TenantCtx::enter(&db, &session, tenant).await?;
        let result = GatewayService::list_audit_in_tenant(&ctx, filter, page, size)
            .await
            .map(|(items, count)| Paginated::new(items, count, page, size));
        tenant_read(ctx, result, |paginated| {
            Envelope::success(paginated, "获取审计日志成功").transform()
        })
        .await
    }

    /// 本租户审计导出：与平台面同一套文件字节与下载头，窗口收窄在作用域之内。
    pub async fn tenant_audit_export(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
        query: web::Query<AuditExportP>,
    ) -> Result<HttpResponse> {
        let session = session(&http)?;
        let tenant = parse_tenant(&path.into_inner())?;
        let format = query.format.unwrap_or(AuditExportFormat::Csv);
        let filter = match AuditFilter::parse_for_tenant(
            tenant,
            query.tenant_id.as_deref(),
            query.actor.as_deref(),
            query.action.as_deref(),
            query.from,
            query.to,
        ) {
            Ok(filter) => filter,
            Err(err) => return Exception::from(err).transform(),
        };
        let ctx = TenantCtx::enter(&db, &session, tenant).await?;
        let result = GatewayService::export_audit_in_tenant(&ctx, filter).await;
        tenant_read(ctx, result, |export| Ok(audit_download(format, &export))).await
    }
}

/// 服务身份出站前的共同前半段：开一段只读租户作用域解析模型与配额，**出站前就结束事务**。
///
/// 嵌入与对话共用同一段，是为了不让两条链路的门禁口径与事务边界分叉——服务面只有一个
/// 入口点，「配额与记账是同一套」这句话才成立。
async fn prepare_service_call(
    db: &Storage,
    redis: &RedisPool,
    config: &Configure,
    tenant_id: TenantId,
    model: &str,
    capability: ServiceCapability,
) -> Result<Prepared, Exception> {
    let tenant = TenantScope::open(db, tenant_id).await.map_err(db_error)?;
    let prepared = GatewayService::prepare_for_service(
        tenant.tx(),
        tenant_id,
        config,
        redis,
        model,
        capability,
    )
    .await;
    tenant.rollback().await.map_err(db_error)?;
    prepared.map_err(Exception::from)
}

/// 把导出行渲染成下载响应：原始字节 + 下载头，**不套 JSON 信封**。
///
/// `X-Export-*` 两个头是给脚本读的：`rows` 说明拿到多少行，`truncated=true` 说明命中量
/// 超过硬上限、文件里只有最新的那一批——只看文件内容无法区分「就这么多」和「被截断了」。
fn audit_download(format: AuditExportFormat, export: &AuditExport) -> HttpResponse {
    HttpResponse::Ok()
        .content_type(render::content_type(format))
        .insert_header(("X-Export-Rows", export.rows.len().to_string()))
        .insert_header(("X-Export-Truncated", export.truncated.to_string()))
        .insert_header(ContentDisposition {
            disposition: DispositionType::Attachment,
            parameters: vec![DispositionParam::Filename(render::filename(
                export.from,
                export.to,
                format,
            ))],
        })
        .body(render::render(format, &export.rows))
}

/// 只读处理：成功先归还事务再出响应；失败尽力回滚（回滚失败也不能盖掉原始错误）。
async fn platform_read<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, GatewayError>,
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

/// 只读处理（租户面）：与 [`platform_read`] 同一套收尾顺序——先归还事务再出响应，
/// 失败时尽力回滚且不让回滚错误盖掉原始错误。
async fn tenant_read<T, F>(
    ctx: TenantCtx,
    result: std::result::Result<T, GatewayError>,
    ok: F,
) -> Result<HttpResponse>
where
    F: FnOnce(T) -> Result<HttpResponse>,
{
    match result {
        Ok(data) => {
            ctx.rollback().await?;
            ok(data)
        }
        Err(err) => {
            if let Err(e) = ctx.rollback().await {
                tracing::warn!(error = %e, "租户作用域回滚失败");
            }
            Exception::from(err).transform()
        }
    }
}

/// 写入处理：**先提交再出响应**，提交失败绝不回 200（否则前端会以为写成功了）。
async fn platform_write<T, F>(
    scope: PlatformScope,
    result: std::result::Result<T, GatewayError>,
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

fn session(http: &HttpRequest) -> Result<Session, Exception> {
    Session::of(http).ok_or_else(|| Exception::unauthorized("用户未登录"))
}

fn tenant_from_header(http: &HttpRequest) -> Option<Uuid> {
    http.headers()
        .get("X-Tenant-ID")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
}

fn client_ip(http: &HttpRequest) -> Option<String> {
    http.peer_addr().map(|a| a.ip().to_string())
}

fn parse_id(value: &str) -> Result<Uuid, Exception> {
    Uuid::parse_str(value).map_err(|_| Exception::bad_request("ID 格式无效"))
}

/// 路径上的租户标识；不合法的 UUID 是 400，不是 404——路由已经匹配上了，
/// 是参数写错而不是资源不存在。
fn parse_tenant(value: &str) -> Result<TenantId, Exception> {
    value
        .parse::<TenantId>()
        .map_err(|_| Exception::bad_request("ID 格式无效"))
}

fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "gateway scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}

/// 审批台账里「已批准」的字面量。
const APPROVED_STATE: &str = "APPROVED";

/// 一条已被批准的可见性写入申请：**原样**来自审批台账里的参数原文。
///
/// 字段名与工具入参口径一致（`assetID`）；这里不接受别的拼法——人批的就是这些字，核心按
/// 同样的字去理解，拼错了就是「批的不是我们能执行的事」，宁可拒。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VisibilityWriteArguments {
    /// 要改的资产。必须与令牌作用域里的那一个一致。
    #[serde(rename = "assetID")]
    asset_id: String,
    /// `PRIVATE` / `PUBLIC` / `RESTRICTED`。
    visibility: String,
    /// 可见对象；仅 `RESTRICTED` 有值。
    #[serde(default)]
    viewers: Vec<String>,
}

/// 核过的审批凭据：令牌签发后写端点只看它，不再回读台账。
#[derive(Debug, Clone)]
struct VisibilityGrant {
    approval_id: String,
    /// 批准人（= 资产创建者），写以他的身份落地。
    actor_id: String,
    visibility: Visibility,
    /// 已规范化成小写带连字符的 uuid 字符串。
    viewers: Vec<String>,
}
