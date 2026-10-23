//! 网关领域服务：模型解析、配额判定、上游转发、用量落库。
//!
//! **作用域约定**：本模块不自己开请求作用域，也不接受「裸」的数据库连接——所有查询都跑在
//! 调用方给的事务上，事务由 [`TenantCtx`](crate::guards::tenant::TenantCtx)（选了租户）、
//! [`AccountScope`](crate::guards::account::AccountScope)（没选租户）或
//! [`PlatformScope`](crate::guards::platform::PlatformScope)（运维面）建立。
//! 这样做的原因有两个：
//!
//! 1. 看得见哪些行由行级策略决定，作用域是唯一的事实来源，服务层不再自己拼 `tenantID = ?`；
//! 2. 上游模型调用是长耗时网络等待，作用域绝不能跨越它——于是解析
//!    （[`GatewayService::prepare`]）与落库（`record_completion`）被切成两段，
//!    各自只包住自己的数据库工作。
//!
//! 唯一的例外在 `StoreScope`：用量/审计写在上游调用结束之后，那时请求作用域已经结束，
//! 于是按 [`Prepared`] 里带出来的身份重新开一段短作用域（租户或账号），写完立即提交。

use std::sync::Arc;
use std::time::Instant;

use actix_web::web::Bytes;
use authz::{Action, Permission, Resource};
use chrono::{DateTime, FixedOffset, Utc};
use entity::{gateway_audit, gateway_model, gateway_provider, gateway_usage, tenant};
use futures::{Stream, StreamExt};
use identity::{PlatformRole, Principal, TenantId, TenantRole, UserId};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::account::AccountScope;
use crate::guards::platform::PlatformScope;
use crate::guards::service::SERVICE_ACTOR_ID;
use crate::guards::tenant::{TenantCtx, TenantScope};
use crate::services::gateway::client::{Upstream, UpstreamError};
use crate::services::gateway::quota::{
    QuotaError, exhausted, quota_key, resets_at_millis, used_tokens,
};
use crate::services::gateway::repository::{UsageInput, record_audit, record_usage};
use crate::services::gateway::schema::{
    AuditFilter, AuditR, ChatCompletionsP, EmbeddingsP, ModelR, ModelUpdateP, ModelWriteP, PlanR,
    PlansR, ProviderR, ProviderUpdateP, ProviderWriteP, SelfQuotaR, UsageQueryP, UsageR,
};
use crate::services::subscription::service::{QuotaInfo, global_quota, quota_in};
use crate::utils::code::{auth as auth_codes, external, request, resource, system};
use crate::utils::db::is_unique_violation;
use crate::utils::encryption::{EncryptionError, decrypt_field, encrypt_field};

/// 目录里的「自动路由」伪模型名：由网关按可用性与能力替调用方挑一个真模型。
///
/// 它是**目录的一部分**（`/models` 会在有可用模型时把它排在首位），这样客户端不必
/// 把 `auto` 这个字符串写死在自己的代码里 —— 客户端只管发目录里读到的名字。
const AUTO_MODEL_NAME: &str = "auto";
const AUTO_MODEL_LABEL: &str = "自动选择";

/// 审计导出的行数硬上限：超过即截断（保留最新），并在响应头标注。
const AUDIT_EXPORT_MAX_ROWS: u64 = 50_000;
/// 导出未指定时间范围时的默认回看窗口（天）。
const AUDIT_EXPORT_DEFAULT_WINDOW_DAYS: i64 = 30;
/// 租户面读审计需要的权限（Owner/Admin 具备、Member 不具备，判定表在 `authz`）。
const READ_AUDIT_EVENT: Permission = Permission::new(Resource::AuditEvent, Action::Read);

/// 审计导出结果：行已按时间倒序取好，序列化（CSV / NDJSON）交给
/// [`render`](crate::services::gateway::render)。
pub struct AuditExport {
    pub rows: Vec<AuditR>,
    /// 是否因超过 [`AUDIT_EXPORT_MAX_ROWS`] 被截断
    pub truncated: bool,
    /// 实际生效的窗口起点（毫秒时间戳）；已补齐默认值，拼下载文件名用
    pub from: i64,
    pub to: i64,
}

impl AuditFilter {
    /// 解析查询参数：平台面按 `tenantID` 收窄，租户面传 `None`（可见范围由路径与作用域决定）。
    ///
    /// 与用量查询不同，这里对非法 UUID **报错**而不是静默忽略：审计是事后追溯入口，
    /// 「过滤条件写错了却看起来查到了结果」比多一次 400 危险得多。
    ///
    /// # Errors
    /// `tenantID`/`actor` 不是合法 UUID、时间戳超出可表示范围、或 `from > to`。
    pub fn parse(
        tenant_id: Option<&str>,
        actor: Option<&str>,
        action: Option<&str>,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<Self, GatewayError> {
        let tenant_id = parse_opt_uuid(tenant_id, "tenantID")?;
        let actor = parse_opt_uuid(actor, "actor")?;
        let action = action
            .map(str::trim)
            .filter(|a| !a.is_empty())
            .map(str::to_owned);
        let from = from.map(|ms| millis(ms, "from")).transpose()?;
        let to = to.map(|ms| millis(ms, "to")).transpose()?;
        if let (Some(from), Some(to)) = (from, to) {
            if from > to {
                return Err(GatewayError::BadParam("from 不能晚于 to".into()));
            }
        }
        Ok(Self {
            tenant_id,
            actor,
            action,
            from,
            to,
        })
    }

    /// 租户面解析：`tenantID` 只允许等于路径上的租户，其余与 [`parse`](Self::parse) 相同。
    ///
    /// 传一致的值是允许的（同一个过滤条件两边都照抄得动），指向别的租户即 400 ——
    /// 静默忽略会让人以为「查的就是那个租户」，而结果里只有本租户的行。
    ///
    /// # Errors
    /// `tenantID` 与路径租户不一致、或同 [`parse`](Self::parse) 的校验失败。
    pub fn parse_for_tenant(
        tenant: TenantId,
        tenant_id: Option<&str>,
        actor: Option<&str>,
        action: Option<&str>,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<Self, GatewayError> {
        if let Some(raw) = tenant_id.map(str::trim).filter(|v| !v.is_empty()) {
            let parsed = Uuid::parse_str(raw)
                .map_err(|_| GatewayError::BadParam("tenantID 必须是合法 UUID".into()))?;
            if parsed != tenant.as_uuid() {
                return Err(GatewayError::BadParam(
                    "tenantID 与路径中的租户不一致；跨租户查询请用平台接口".into(),
                ));
            }
        }
        // 可见性交给作用域：这里把 `tenantID` 归零，查询条件里就没有租户这一项
        Self::parse(None, actor, action, from, to)
    }

    /// 补齐导出窗口：缺 `to` 取当前时刻，缺 `from` 取 `to` 往前 [`AUDIT_EXPORT_DEFAULT_WINDOW_DAYS`] 天。
    ///
    /// 导出必须有一个有界窗口——不限时间的全表导出正是这个接口最容易被误用的方式。
    fn with_default_window(mut self) -> Self {
        let to = self.to.unwrap_or_else(|| Utc::now().fixed_offset());
        let from = self
            .from
            .unwrap_or_else(|| to - chrono::Duration::days(AUDIT_EXPORT_DEFAULT_WINDOW_DAYS));
        self.from = Some(from);
        self.to = Some(to);
        self
    }
}

fn parse_opt_uuid(raw: Option<&str>, field: &str) -> Result<Option<Uuid>, GatewayError> {
    match raw.map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => Uuid::parse_str(value)
            .map(Some)
            .map_err(|_| GatewayError::BadParam(format!("{field} 必须是合法 UUID"))),
        None => Ok(None),
    }
}

fn millis(value: i64, field: &str) -> Result<DateTime<FixedOffset>, GatewayError> {
    DateTime::<Utc>::from_timestamp_millis(value)
        .map(|t| t.fixed_offset())
        .ok_or_else(|| GatewayError::BadParam(format!("{field} 必须是毫秒时间戳")))
}

#[derive(Debug, thiserror::Error)]
pub enum GatewayError {
    #[error("Model not found: {0}")]
    ModelNotFound(String),
    #[error("Provider not found")]
    ProviderNotFound,
    #[error("Model disabled")]
    ModelDisabled,
    #[error("Provider disabled")]
    ProviderDisabled,
    #[error("Model not allowed for role")]
    NotAllowed,
    #[error("Forbidden")]
    Forbidden,
    #[error("Quota exceeded")]
    QuotaExceeded,
    #[error("Provider kind unsupported: {0}")]
    UnsupportedKind(String),
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error(transparent)]
    Upstream(#[from] UpstreamError),
    #[error(transparent)]
    Quota(#[from] QuotaError),
    #[error(transparent)]
    Encryption(#[from] EncryptionError),
    #[error("Database error: {0}")]
    Db(String),
}

impl From<GatewayError> for Exception {
    fn from(err: GatewayError) -> Self {
        match err {
            GatewayError::ModelNotFound(_) => Exception::custom(resource::NOT_FOUND, "模型不存在"),
            GatewayError::ProviderNotFound => {
                Exception::custom(resource::NOT_FOUND, "供应商不存在")
            }
            GatewayError::ModelDisabled | GatewayError::ProviderDisabled => {
                Exception::custom(resource::ACCESS_RESTRICTED, "模型已停用")
            }
            GatewayError::NotAllowed => {
                Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "无权使用该模型")
            }
            GatewayError::Forbidden => {
                Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "权限不足")
            }
            GatewayError::QuotaExceeded => {
                Exception::custom(resource::QUOTA_EXCEEDED, "配额已用尽")
            }
            GatewayError::UnsupportedKind(kind) => Exception::custom(
                request::INVALID_PARAMETER_VALUE,
                format!("供应商暂不支持: {kind}"),
            ),
            GatewayError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            GatewayError::Upstream(_) => {
                Exception::custom(external::THIRD_PARTY_API_ERROR, "模型服务暂不可用")
            }
            GatewayError::Quota(_) => Exception::custom(external::CACHE_ERROR, "缓存服务异常"),
            GatewayError::Encryption(_) => {
                Exception::custom(system::INTERNAL_ERROR, "密钥服务异常")
            }
            GatewayError::Db(msg) => {
                tracing::error!(error = %msg, "gateway database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

/// 配额的归属维度：有租户身份就记在租户上，否则记在账号上。
///
/// 与作用域无关：账号作用域下聊天（没选租户）同样按账号记账，两者共用一个键。
enum QuotaScope {
    User(Uuid),
    Tenant(Uuid),
}

impl QuotaScope {
    fn as_str(&self) -> &'static str {
        match self {
            Self::User(_) => "USER",
            Self::Tenant(_) => "TENANT",
        }
    }

    fn id(&self) -> Uuid {
        match self {
            Self::User(id) | Self::Tenant(id) => *id,
        }
    }
}

/// 配额归属：有租户身份就记在租户上，否则记在用户上。
fn quota_scope(user_id: Uuid, tenant_id: Option<Uuid>) -> QuotaScope {
    match tenant_id {
        Some(tid) => QuotaScope::Tenant(tid),
        None => QuotaScope::User(user_id),
    }
}

/// 进入上游之前就已经定下来的事实：模型、供应商、密钥、配额归属与上限。
///
/// 它必须能被带出请求作用域——上游调用的耗时不允许被事务包住，用量落库只能发生在其后，
/// 于是落库需要的身份（`user_id` / `tenant_id`）一并带上。
pub struct Prepared {
    model: gateway_model::Model,
    provider: gateway_provider::Model,
    api_key: Option<String>,
    scope: QuotaScope,
    quota_limit: i64,
    user_id: Uuid,
    tenant_id: Option<Uuid>,
}

/// 一次调用在落库时需要的身份与目标（不随请求作用域存活）。
struct CompletionMeta {
    user_id: Uuid,
    tenant_id: Option<Uuid>,
    provider_id: Uuid,
    model_id: Uuid,
    model_name: String,
    quota_key: String,
    /// 审计行的动作名（`gateway.chat` / `gateway.embeddings`）：
    /// 用量表只需要模型与 token，审计表需要能区分「这次调用干了什么」。
    action: &'static str,
}

pub struct GatewayService;

impl GatewayService {
    /// 在**调用方给的作用域**里解析一次聊天请求。
    ///
    /// 身份来自 [`Principal`]：模型可见性（`allow_roles`）与配额归属都由它决定，
    /// 而它已经在进作用域时确定过（成员关系、平台角色），服务层不再查第二遍。
    ///
    /// # Errors
    /// 模型/供应商不存在或停用、角色不允许、数据库读取失败、密钥解密失败。
    pub async fn prepare(
        tx: &DatabaseTransaction,
        principal: &Principal,
        config: &Configure,
        redis: &RedisPool,
        model_name: &str,
    ) -> Result<Prepared, GatewayError> {
        let user_id = principal.user_id().as_uuid();
        let tenant_id = principal.tenant_id().map(|tenant| tenant.as_uuid());
        let tenant_role = principal.tenant_role();
        let platform_role = principal.platform_role();

        let model = if model_name.eq_ignore_ascii_case(AUTO_MODEL_NAME) {
            pick_auto_model(tx, platform_role, tenant_role).await?
        } else {
            find_model(tx, model_name, tenant_id).await?
        };
        if !model.enabled {
            return Err(GatewayError::ModelDisabled);
        }
        if !role_allowed(&model, platform_role, tenant_role) {
            return Err(GatewayError::NotAllowed);
        }

        assemble(tx, config, redis, model, user_id, tenant_id).await
    }

    /// 在**调用方给的作用域**里解析一次服务身份的出站请求。
    ///
    /// 与 [`prepare`](Self::prepare) 的关键差别是「授权从哪来」：这里没有人员角色，
    /// 授权完全来自服务令牌的作用域（租户 + 模型），因此不做 `role_allowed` 判定；
    /// 反过来，模型必须显式声明[所需能力](ServiceCapability)，且不接受 `auto`
    /// （服务进程要的是确定性，不是「帮我挑一个」）。配额与记账按令牌里的租户归属。
    ///
    /// # Errors
    /// 模型不存在/停用/缺所需能力、供应商不存在或停用、数据库读取失败、密钥解密失败。
    pub async fn prepare_for_service(
        tx: &DatabaseTransaction,
        tenant_id: TenantId,
        config: &Configure,
        redis: &RedisPool,
        model_name: &str,
        capability: ServiceCapability,
    ) -> Result<Prepared, GatewayError> {
        let tid = tenant_id.as_uuid();
        let model = find_model(tx, model_name, Some(tid)).await?;
        if !model.enabled {
            return Err(GatewayError::ModelDisabled);
        }
        capability.check(&model)?;

        assemble(tx, config, redis, model, SERVICE_ACTOR_ID, Some(tid)).await
    }

    /// 流式转发（SSE 直传）。解析与配额判定已在 [`prepare`](Self::prepare) 里完成。
    ///
    /// 用 `Arc` 收参数是为了 `'static` 的流：上游连接要活到客户端读完为止，
    /// 落库时机（`record_completion`）也在流结束之后，那时借用早已失效。
    #[allow(clippy::too_many_arguments)]
    pub async fn chat_stream(
        db: Arc<Storage>,
        redis: Arc<RedisPool>,
        config: Arc<Configure>,
        upstream: &Upstream,
        prepared: Prepared,
        req: &ChatCompletionsP,
        ip: Option<String>,
    ) -> Result<impl Stream<Item = Result<Bytes, actix_web::Error>> + 'static, GatewayError> {
        let key = quota_key_for(&prepared.scope);
        if exhausted(&redis, &key, prepared.quota_limit).await? {
            return Err(GatewayError::QuotaExceeded);
        }

        let body = build_body(req, &prepared.model.name, true);
        let url = chat_url(&prepared.provider)?;
        let resp = upstream
            .post_chat(&url, prepared.api_key.as_deref(), &body)
            .await?;

        let meta = CompletionMeta {
            user_id: prepared.user_id,
            tenant_id: prepared.tenant_id,
            provider_id: prepared.provider.id,
            model_id: prepared.model.id,
            model_name: prepared.model.name.clone(),
            quota_key: key,
            action: "gateway.chat",
        };
        let record = Record {
            meta,
            db,
            redis,
            config,
            ip,
            started: Instant::now(),
            buffer: String::new(),
            usage: None,
            failed: false,
        };

        Ok(sse_stream(resp, record))
    }

    /// 非流式转发：上游 JSON 原样返回，落库在响应之前完成（调用方无事务在身）。
    pub async fn chat_json(
        db: &Storage,
        redis: &RedisPool,
        config: &Configure,
        upstream: &Upstream,
        prepared: Prepared,
        req: &ChatCompletionsP,
        ip: Option<String>,
    ) -> Result<Value, GatewayError> {
        let key = quota_key_for(&prepared.scope);
        if exhausted(redis, &key, prepared.quota_limit).await? {
            return Err(GatewayError::QuotaExceeded);
        }

        let body = build_body(req, &prepared.model.name, false);
        let url = chat_url(&prepared.provider)?;
        let started = Instant::now();
        let resp = upstream
            .post_chat(&url, prepared.api_key.as_deref(), &body)
            .await?;
        let text = resp.text().await.map_err(UpstreamError::Http)?;
        let latency = started.elapsed().as_millis() as i64;

        let value: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
        let usage = value.get("usage").map(parse_usage_json);

        record_completion(
            db,
            redis,
            config,
            &CompletionMeta {
                user_id: prepared.user_id,
                tenant_id: prepared.tenant_id,
                provider_id: prepared.provider.id,
                model_id: prepared.model.id,
                model_name: prepared.model.name.clone(),
                quota_key: key,
                action: "gateway.chat",
            },
            usage,
            "OK",
            latency,
            ip,
        )
        .await;

        Ok(value)
    }

    /// 服务身份的嵌入转发：上游 JSON 原样返回，记账在响应之前完成。
    ///
    /// 与 [`chat_json`](Self::chat_json) 是同一套时序（配额预检 → 出站 → 落库 → 返回），
    /// 差别只有出站路径、请求体组装与审计动作名——记账这一块必须共用，否则服务调用的
    /// 用量会悄悄绕过配额（那正是「gateway 是唯一出网点」这句话要防的事）。
    #[allow(clippy::too_many_arguments)]
    pub async fn embed_json(
        db: &Storage,
        redis: &RedisPool,
        config: &Configure,
        upstream: &Upstream,
        prepared: Prepared,
        req: &EmbeddingsP,
        ip: Option<String>,
    ) -> Result<Value, GatewayError> {
        let key = quota_key_for(&prepared.scope);
        if exhausted(redis, &key, prepared.quota_limit).await? {
            return Err(GatewayError::QuotaExceeded);
        }

        let body = build_embeddings_body(req, &prepared.model.name);
        let url = embeddings_url(&prepared.provider)?;
        let started = Instant::now();
        let value = upstream
            .post_json(&url, prepared.api_key.as_deref(), &body)
            .await?;
        let latency = started.elapsed().as_millis() as i64;
        let usage = value.get("usage").map(parse_usage_json);

        record_completion(
            db,
            redis,
            config,
            &CompletionMeta {
                user_id: prepared.user_id,
                tenant_id: prepared.tenant_id,
                provider_id: prepared.provider.id,
                model_id: prepared.model.id,
                model_name: prepared.model.name.clone(),
                quota_key: key,
                action: "gateway.embeddings",
            },
            usage,
            "OK",
            latency,
            ip,
        )
        .await;

        Ok(value)
    }

    /// 用户可见模型列表（全局 + 当前租户，按 enabled + allow_roles 过滤）。
    ///
    /// 可见行不再手写 `tenantID = ?`：策略已经保证「全局行 + 当前租户行」正好是能看到的那些，
    /// 于是同一个查询在租户作用域与账号作用域下各自得到正确的集合。
    ///
    /// 有可见模型时会在首位插入 `auto`（自动路由）伪条目 —— 目录即契约，
    /// 客户端点它就能让网关代挑模型。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn list_models(
        tx: &DatabaseTransaction,
        principal: &Principal,
    ) -> Result<Vec<ModelR>, GatewayError> {
        let models = gateway_model::Entity::find()
            .filter(gateway_model::Column::Enabled.eq(true))
            .all(tx)
            .await
            .map_err(db_err)?;

        let names = provider_names(tx).await?;
        let mut out: Vec<ModelR> = models
            .into_iter()
            .filter(|m| role_allowed(m, principal.platform_role(), principal.tenant_role()))
            .map(|m| {
                let provider_name = names.get(&m.provider_id).cloned();
                model_to_r(m, provider_name)
            })
            .collect();

        if !out.is_empty() {
            out.insert(0, auto_model_r());
        }
        Ok(out)
    }

    /// 只读自助配额：当前身份此刻的日窗用量与上限。
    ///
    /// 上限与归属与聊天热路径共用（`quota_scope` / `resolve_quota`），否则界面上的剩余量
    /// 与真正拦截请求的数字会对不上。成员关系不在这里判：作用域由守卫建立，
    /// 不是成员且不是平台管理员就进不了租户作用域（403）。
    ///
    /// # Errors
    /// 数据库读取失败、缓存不可用。
    pub async fn self_quota(
        tx: &DatabaseTransaction,
        principal: &Principal,
        config: &Configure,
        redis: &RedisPool,
        model_name: Option<&str>,
    ) -> Result<SelfQuotaR, GatewayError> {
        let tenant_id = principal.tenant_id().map(|tenant| tenant.as_uuid());
        let scope = quota_scope(principal.user_id().as_uuid(), tenant_id);
        let key = quota_key_for(&scope);
        let model = match model_name {
            // `auto` 要等网关挑完才知道是哪条模型，这里按身份级配额回答
            Some(name) if !name.eq_ignore_ascii_case(AUTO_MODEL_NAME) => {
                match find_model(tx, name, tenant_id).await {
                    Ok(model) => Some(model),
                    Err(GatewayError::ModelNotFound(_)) => None,
                    Err(err) => return Err(err),
                }
            }
            _ => None,
        };
        let (limit, info) = resolve_quota(tx, config, redis, tenant_id, model.as_ref()).await?;
        let used = used_tokens(redis, &key).await?;
        let (source, plan) = match info {
            Some(info) => (info.source.as_str().to_string(), info.plan),
            None => ("MODEL".to_string(), None),
        };
        let tenant_type = match tenant_id {
            Some(tid) => tenant::Entity::find_by_id(tid)
                .one(tx)
                .await
                .map_err(db_err)?
                .map(|row| row.tenant_type),
            None => None,
        };

        Ok(SelfQuotaR {
            scope: scope.as_str().to_string(),
            scope_id: scope.id().to_string(),
            tenant_id: tenant_id.map(|tid| tid.to_string()),
            tenant_type,
            source,
            plan,
            limit,
            used,
            remaining: (limit - used).max(0),
            exhausted: used >= limit,
            resets_at: resets_at_millis(),
        })
    }

    /// 档位目录：可开通档位（按配额从低到高）+ 免费档基线。
    ///
    /// 档位只有「名字 + 日配额」两个事实，都出自 `gateway.plan_daily_token_quota`（不落库），
    /// 客户端据此渲染档位卡，而不是让用户手填档位名。
    pub fn list_plans(config: &Configure) -> PlansR {
        let mut plans: Vec<PlanR> = config
            .gateway_plan_daily_token_quota_table()
            .iter()
            .filter(|(_, quota)| **quota > 0)
            .map(|(plan, quota)| PlanR {
                plan: plan.clone(),
                daily_token_quota: *quota,
            })
            .collect();
        plans.sort_by(|a, b| {
            a.daily_token_quota
                .cmp(&b.daily_token_quota)
                .then_with(|| a.plan.cmp(&b.plan))
        });
        PlansR {
            plans,
            free_daily_token_quota: config.gateway_free_daily_token_quota(),
        }
    }

    // ---- 后台 provider CRUD（平台级：tenant_id IS NULL，跑在平台特权作用域里）----

    /// 平台供应商列表。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn list_providers(scope: &PlatformScope) -> Result<Vec<ProviderR>, GatewayError> {
        let providers = gateway_provider::Entity::find()
            .filter(gateway_provider::Column::TenantId.is_null())
            .all(scope.tx())
            .await
            .map_err(db_err)?;
        Ok(providers.into_iter().map(provider_to_r).collect())
    }

    /// 新建平台供应商（`tenant_id IS NULL`）。
    ///
    /// # Errors
    /// 参数非法、密钥加密失败、数据库写入失败。
    pub async fn create_provider(
        scope: &PlatformScope,
        config: &Configure,
        actor: Uuid,
        req: ProviderWriteP,
    ) -> Result<ProviderR, GatewayError> {
        validate_kind(&req.kind)?;
        if req.base_url.trim().is_empty() || req.name.trim().is_empty() {
            return Err(GatewayError::BadParam(
                "name 与 baseUrl 不能为空".to_string(),
            ));
        }
        let api_key_enc = encrypt_api_key(config, req.api_key.as_deref())?;
        let now = Utc::now().fixed_offset();
        let model = gateway_provider::ActiveModel {
            id: Set(Uuid::new_v4()),
            tenant_id: Set(None),
            kind: Set(req.kind),
            name: Set(req.name.trim().to_string()),
            base_url: Set(req.base_url.trim().to_string()),
            api_key_enc: Set(api_key_enc),
            status: Set(parse_status(req.status.as_deref())?),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(Some(actor)),
            updated_at: Set(now),
            updater: Set(Some(actor)),
            expires_at: Set(None),
        }
        .insert(scope.tx())
        .await
        .map_err(db_err)?;
        Ok(provider_to_r(model))
    }

    /// 改平台供应商；只认 `tenant_id IS NULL` 的行（改不到即 404，不再静默成功）。
    ///
    /// # Errors
    /// 供应商不存在、参数非法、密钥加密失败、数据库写入失败。
    pub async fn update_provider(
        scope: &PlatformScope,
        config: &Configure,
        actor: Uuid,
        id: Uuid,
        req: ProviderUpdateP,
    ) -> Result<ProviderR, GatewayError> {
        let model = gateway_provider::Entity::find_by_id(id)
            .filter(gateway_provider::Column::TenantId.is_null())
            .one(scope.tx())
            .await
            .map_err(db_err)?
            .ok_or(GatewayError::ProviderNotFound)?;

        let mut active: gateway_provider::ActiveModel = model.into();
        if let Some(kind) = req.kind {
            validate_kind(&kind)?;
            active.kind = Set(kind);
        }
        if let Some(name) = req.name {
            if name.trim().is_empty() {
                return Err(GatewayError::BadParam("name 不能为空".to_string()));
            }
            active.name = Set(name.trim().to_string());
        }
        if let Some(base_url) = req.base_url {
            if base_url.trim().is_empty() {
                return Err(GatewayError::BadParam("baseUrl 不能为空".to_string()));
            }
            active.base_url = Set(base_url.trim().to_string());
        }
        if let Some(key) = req.api_key {
            active.api_key_enc = Set(encrypt_api_key(config, Some(&key))?);
        }
        if let Some(status) = req.status {
            active.status = Set(parse_status(Some(&status))?);
        }
        active.updated_at = Set(Utc::now().fixed_offset());
        active.updater = Set(Some(actor));

        let updated = active.update(scope.tx()).await.map_err(db_err)?;
        Ok(provider_to_r(updated))
    }

    /// 删平台供应商；只认 `tenant_id IS NULL` 的行（删不到即 404）。
    ///
    /// # Errors
    /// 供应商不存在、数据库写入失败。
    pub async fn delete_provider(scope: &PlatformScope, id: Uuid) -> Result<(), GatewayError> {
        let deleted = gateway_provider::Entity::delete_many()
            .filter(gateway_provider::Column::Id.eq(id))
            .filter(gateway_provider::Column::TenantId.is_null())
            .exec(scope.tx())
            .await
            .map_err(db_err)?;
        if deleted.rows_affected == 0 {
            return Err(GatewayError::ProviderNotFound);
        }
        Ok(())
    }

    // ---- 后台 model CRUD（平台级：tenant_id IS NULL）----

    /// 平台模型列表。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn list_models_admin(scope: &PlatformScope) -> Result<Vec<ModelR>, GatewayError> {
        let models = gateway_model::Entity::find()
            .filter(gateway_model::Column::TenantId.is_null())
            .all(scope.tx())
            .await
            .map_err(db_err)?;
        let names = provider_names(scope.tx()).await?;
        Ok(models
            .into_iter()
            .map(|m| {
                let provider_name = names.get(&m.provider_id).cloned();
                model_to_r(m, provider_name)
            })
            .collect())
    }

    /// 新建平台模型（`tenant_id IS NULL`）。
    ///
    /// # Errors
    /// 参数非法、模型重名、数据库写入失败。
    pub async fn create_model(
        scope: &PlatformScope,
        actor: Uuid,
        req: ModelWriteP,
    ) -> Result<ModelR, GatewayError> {
        let provider_id = parse_uuid(&req.provider_id)
            .map_err(|_| GatewayError::BadParam("providerId 无效".to_string()))?;
        if req.name.trim().is_empty() {
            return Err(GatewayError::BadParam("name 不能为空".to_string()));
        }
        if req.name.trim().eq_ignore_ascii_case(AUTO_MODEL_NAME) {
            return Err(GatewayError::BadParam(
                "auto 为网关保留的自动路由模型名".to_string(),
            ));
        }
        let now = Utc::now().fixed_offset();
        let model = gateway_model::ActiveModel {
            id: Set(Uuid::new_v4()),
            provider_id: Set(provider_id),
            tenant_id: Set(None),
            name: Set(req.name.trim().to_string()),
            label: Set(req.label),
            allow_roles: Set(roles_to_json(req.allow_roles)),
            enabled: Set(req.enabled.unwrap_or(true)),
            daily_token_quota: Set(req.daily_token_quota.unwrap_or(0)),
            capabilities: Set(normalize_capabilities(req.capabilities)?),
            context_window: Set(normalize_context_window(req.context_window)),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(Some(actor)),
            updated_at: Set(now),
            updater: Set(Some(actor)),
            expires_at: Set(None),
        }
        .insert(scope.tx())
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                GatewayError::BadParam("模型已存在".to_string())
            } else {
                db_err(e)
            }
        })?;
        let provider_name = find_provider_name(scope.tx(), model.provider_id).await;
        Ok(model_to_r(model, provider_name))
    }

    /// 改平台模型；只认 `tenant_id IS NULL` 的行（改不到即 404）。
    ///
    /// # Errors
    /// 模型不存在、参数非法、数据库写入失败。
    pub async fn update_model(
        scope: &PlatformScope,
        actor: Uuid,
        id: Uuid,
        req: ModelUpdateP,
    ) -> Result<ModelR, GatewayError> {
        let model = gateway_model::Entity::find_by_id(id)
            .filter(gateway_model::Column::TenantId.is_null())
            .one(scope.tx())
            .await
            .map_err(db_err)?
            .ok_or_else(|| GatewayError::ModelNotFound(id.to_string()))?;

        let mut active: gateway_model::ActiveModel = model.into();
        if let Some(name) = req.name {
            if name.trim().is_empty() {
                return Err(GatewayError::BadParam("name 不能为空".to_string()));
            }
            active.name = Set(name.trim().to_string());
        }
        if let Some(label) = req.label {
            active.label = Set(label);
        }
        if req.allow_roles.is_some() {
            active.allow_roles = Set(roles_to_json(req.allow_roles));
        }
        if let Some(enabled) = req.enabled {
            active.enabled = Set(enabled);
        }
        if let Some(quota) = req.daily_token_quota {
            active.daily_token_quota = Set(quota);
        }
        if req.capabilities.is_some() {
            active.capabilities = Set(normalize_capabilities(req.capabilities)?);
        }
        if let Some(window) = req.context_window {
            active.context_window = Set(normalize_context_window(Some(window)));
        }
        active.updated_at = Set(Utc::now().fixed_offset());
        active.updater = Set(Some(actor));

        let updated = active.update(scope.tx()).await.map_err(db_err)?;
        let provider_name = find_provider_name(scope.tx(), updated.provider_id).await;
        Ok(model_to_r(updated, provider_name))
    }

    /// 删平台模型；只认 `tenant_id IS NULL` 的行（删不到即 404）。
    ///
    /// # Errors
    /// 模型不存在、数据库写入失败。
    pub async fn delete_model(scope: &PlatformScope, id: Uuid) -> Result<(), GatewayError> {
        let deleted = gateway_model::Entity::delete_many()
            .filter(gateway_model::Column::Id.eq(id))
            .filter(gateway_model::Column::TenantId.is_null())
            .exec(scope.tx())
            .await
            .map_err(db_err)?;
        if deleted.rows_affected == 0 {
            return Err(GatewayError::ModelNotFound(id.to_string()));
        }
        Ok(())
    }

    // ---- 用量 / 审计查询（跨租户汇总，平台特权作用域）----

    /// 用量明细分页；`tenantID` 过滤是查询条件的一部分（特权作用域看得到所有行）。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn list_usage(
        scope: &PlatformScope,
        req: UsageQueryP,
    ) -> Result<(Vec<UsageR>, u64), GatewayError> {
        let size = req.size.unwrap_or(50).clamp(1, 200);
        let page = req.page.unwrap_or(1).max(1);

        let mut query = gateway_usage::Entity::find();
        if let Some(tid) = req.tenant_id.as_deref() {
            if let Ok(id) = Uuid::parse_str(tid) {
                query = query.filter(gateway_usage::Column::TenantId.eq(Some(id)));
            }
        }
        if let Some(mid) = req.model_id.as_deref() {
            if let Ok(id) = Uuid::parse_str(mid) {
                query = query.filter(gateway_usage::Column::ModelId.eq(id));
            }
        }
        if let Some(from) = req.from {
            query = query.filter(
                gateway_usage::Column::CreatedAt.gte(
                    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(from)
                        .map(|t| t.fixed_offset())
                        .unwrap_or(Utc::now().fixed_offset()),
                ),
            );
        }
        if let Some(to) = req.to {
            query = query.filter(
                gateway_usage::Column::CreatedAt.lte(
                    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(to)
                        .map(|t| t.fixed_offset())
                        .unwrap_or(Utc::now().fixed_offset()),
                ),
            );
        }

        let count = query.clone().count(scope.tx()).await.map_err(db_err)?;
        // 对外 page 从 1 起（与 Paginated::new 的 next/prev 语义一致），sea-orm 从 0 起
        let items = query
            .order_by_desc(gateway_usage::Column::CreatedAt)
            .paginate(scope.tx(), size as u64)
            .fetch_page((page as u64).saturating_sub(1))
            .await
            .map_err(db_err)?;

        Ok((items.into_iter().map(usage_to_r).collect(), count))
    }

    /// 审计日志分页（可选按租户/操作者/动作/时间过滤）。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn list_audit(
        scope: &PlatformScope,
        filter: AuditFilter,
        page: u32,
        size: u32,
    ) -> Result<(Vec<AuditR>, u64), GatewayError> {
        audit_list(scope.tx(), &filter, page, size).await
    }

    /// 审计日志分页（租户面：只看得到本租户的行，外加无租户归属但属于本人的行）。
    ///
    /// # Errors
    /// 权限不足（需要 `audit_event:read`，租户 Owner/Admin 具备）；数据库读取失败。
    pub async fn list_audit_in_tenant(
        ctx: &TenantCtx,
        filter: AuditFilter,
        page: u32,
        size: u32,
    ) -> Result<(Vec<AuditR>, u64), GatewayError> {
        require_audit_read(ctx)?;
        audit_list(ctx.tx(), &filter, page, size).await
    }

    /// 审计导出（平台特权作用域，跨租户）：按时间倒序取窗口内的行，最多 [`AUDIT_EXPORT_MAX_ROWS`] 行。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn export_audit(
        scope: &PlatformScope,
        filter: AuditFilter,
    ) -> Result<AuditExport, GatewayError> {
        audit_export(scope.tx(), filter).await
    }

    /// 审计导出（租户面）。
    ///
    /// # Errors
    /// 权限不足（需要 `audit_event:read`）；数据库读取失败。
    pub async fn export_audit_in_tenant(
        ctx: &TenantCtx,
        filter: AuditFilter,
    ) -> Result<AuditExport, GatewayError> {
        require_audit_read(ctx)?;
        audit_export(ctx.tx(), filter).await
    }
}

/// 租户面审计读权限：Owner/Admin 具备、Member 不具备（判定表在 `authz`，这里不重复业务规则）。
fn require_audit_read(ctx: &TenantCtx) -> Result<(), GatewayError> {
    ctx.require(READ_AUDIT_EVENT)
        .map_err(|_| GatewayError::Forbidden)
}

/// 审计行收窄条件：**不含可见性**——看得到哪些行完全由作用域的行级策略决定。
fn audit_query(filter: &AuditFilter) -> sea_orm::Select<gateway_audit::Entity> {
    let mut query = gateway_audit::Entity::find();
    if let Some(tenant_id) = filter.tenant_id {
        // `tenantID` 可空，平台面按租户收窄时**不**包含无租户归属的行
        query = query.filter(gateway_audit::Column::TenantId.eq(Some(tenant_id)));
    }
    if let Some(actor) = filter.actor {
        query = query.filter(gateway_audit::Column::Actor.eq(actor));
    }
    if let Some(action) = filter.action.as_deref() {
        query = query.filter(gateway_audit::Column::Action.eq(action));
    }
    if let Some(from) = filter.from {
        query = query.filter(gateway_audit::Column::CreatedAt.gte(from));
    }
    if let Some(to) = filter.to {
        query = query.filter(gateway_audit::Column::CreatedAt.lte(to));
    }
    query
}

/// 审计列表：列表与导出共用同一段查询，差别只在分页/取行。
async fn audit_list(
    tx: &DatabaseTransaction,
    filter: &AuditFilter,
    page: u32,
    size: u32,
) -> Result<(Vec<AuditR>, u64), GatewayError> {
    let size = size.clamp(1, 200);
    let page = page.max(1);
    let count = audit_query(filter).count(tx).await.map_err(db_err)?;
    // 对外 page 从 1 起（与 Paginated::new 的 next/prev 语义一致），sea-orm 从 0 起
    let items = audit_query(filter)
        .order_by_desc(gateway_audit::Column::CreatedAt)
        .paginate(tx, size as u64)
        .fetch_page((page as u64).saturating_sub(1))
        .await
        .map_err(db_err)?;
    Ok((items.into_iter().map(audit_to_r).collect(), count))
}

/// 审计导出：补齐默认时间窗口 → 多取一行探边界 → 截断到上限。
///
/// 截断保留的是**最新**的行（倒序取，丢尾部）。
async fn audit_export(
    tx: &DatabaseTransaction,
    filter: AuditFilter,
) -> Result<AuditExport, GatewayError> {
    let filter = filter.with_default_window();
    let rows = audit_query(&filter)
        .order_by_desc(gateway_audit::Column::CreatedAt)
        .limit(AUDIT_EXPORT_MAX_ROWS + 1)
        .all(tx)
        .await
        .map_err(db_err)?;
    let (rows, truncated) = cap_rows(rows, AUDIT_EXPORT_MAX_ROWS as usize);
    Ok(AuditExport {
        rows: rows.into_iter().map(audit_to_r).collect(),
        truncated,
        from: filter
            .from
            .map(|t| t.timestamp_millis())
            .unwrap_or_default(),
        to: filter.to.map(|t| t.timestamp_millis()).unwrap_or_default(),
    })
}

/// 按硬上限截断：「多取一行」是探边界的手段，截断前先判断再丢尾，
/// 才能区分「正好取满」与「还有更多」——只按 `len == cap` 判断会把取满的结果误报成截断。
///
/// 抽成泛型纯函数是为了能不起数据库就测这条边界。
fn cap_rows<T>(mut rows: Vec<T>, cap: usize) -> (Vec<T>, bool) {
    let truncated = rows.len() > cap;
    rows.truncate(cap);
    (rows, truncated)
}

/// 日配额上限及其身份级来源：模型覆盖 > 租户/账号级（订阅档位 > 免费档 > 全局兜底）。
///
/// 命中模型覆盖时**不查**身份级配额，返回 `None` —— 聊天热路径不必为此多打一次 Redis。
/// 聊天拦截与只读自助查询共用它，保证「界面显示的剩余」与「服务端拦截的数字」同源。
async fn resolve_quota(
    tx: &DatabaseTransaction,
    config: &Configure,
    redis: &RedisPool,
    tenant_id: Option<Uuid>,
    model: Option<&gateway_model::Model>,
) -> Result<(i64, Option<QuotaInfo>), GatewayError> {
    if let Some(quota) = model.map(|m| m.daily_token_quota).filter(|q| *q > 0) {
        return Ok((quota, None));
    }
    // 没有租户身份（账号作用域）时读不到 `tenant` / `subscription` 任何一行，
    // 直接取全局兜底，不白跑一趟数据库
    let info = match tenant_id {
        Some(tid) => quota_in(tx, config, redis, TenantId::from_uuid(tid))
            .await
            .map_err(db_err)?
            .unwrap_or_else(|| global_quota(config)),
        None => global_quota(config),
    };
    Ok((info.limit, Some(info)))
}

/// 模型已选定之后的部分：供应商可用性、密钥解密、配额上限、归属身份。
///
/// 聊天与服务身份两条解析路径的**唯一**差别只在「模型怎么挑、谁被授权」，
/// 剩下的（供应商/密钥/配额/记账归属）完全一致，于是抽在这里，避免两份实现漂移。
async fn assemble(
    tx: &DatabaseTransaction,
    config: &Configure,
    redis: &RedisPool,
    model: gateway_model::Model,
    user_id: Uuid,
    tenant_id: Option<Uuid>,
) -> Result<Prepared, GatewayError> {
    let provider = gateway_provider::Entity::find_by_id(model.provider_id)
        .one(tx)
        .await
        .map_err(db_err)?
        .ok_or(GatewayError::ProviderNotFound)?;
    if provider.status != "ACTIVE" {
        return Err(GatewayError::ProviderDisabled);
    }

    let api_key = if provider.api_key_enc.is_empty() {
        None
    } else {
        let aes_key = config.aes_key().ok_or(EncryptionError::InvalidKeyLength)?;
        Some(decrypt_field(&provider.api_key_enc, aes_key)?)
    };

    // 配额优先级：模型覆盖 > 租户级（订阅档位 > 免费档 / 全局兜底）
    let (quota_limit, _) = resolve_quota(tx, config, redis, tenant_id, Some(&model)).await?;

    Ok(Prepared {
        model,
        provider,
        api_key,
        scope: quota_scope(user_id, tenant_id),
        quota_limit,
        user_id,
        tenant_id,
    })
}

/// 取模型：当前租户的私有模型优先，其次全局模型。
///
/// 两种来源都要显式区分（策略只保证「可见」，不保证 `name` 唯一），
/// 因此这里逐个查而不是一次 `one()`——多行时 `one()` 会报错。
async fn find_model(
    tx: &DatabaseTransaction,
    name: &str,
    tenant_id: Option<Uuid>,
) -> Result<gateway_model::Model, GatewayError> {
    if let Some(tid) = tenant_id {
        let scoped = gateway_model::Entity::find()
            .filter(gateway_model::Column::Name.eq(name))
            .filter(gateway_model::Column::TenantId.eq(Some(tid)))
            .one(tx)
            .await
            .map_err(db_err)?;
        if let Some(m) = scoped {
            return Ok(m);
        }
    }

    gateway_model::Entity::find()
        .filter(gateway_model::Column::Name.eq(name))
        .filter(gateway_model::Column::TenantId.is_null())
        .one(tx)
        .await
        .map_err(db_err)?
        .ok_or(GatewayError::ModelNotFound(name.to_string()))
}

/// 自动路由：在当前身份可见的模型里挑一个。
///
/// 排序偏好（越靠前越优先）：平台模型 → 支持工具的模型 → 创建早的（稳定优先）。
/// 不做语义路由（不猜「这条消息该用谁」），只保证「目录里有 auto 就一定挑得出模型」。
async fn pick_auto_model(
    tx: &DatabaseTransaction,
    platform_role: PlatformRole,
    tenant_role: Option<TenantRole>,
) -> Result<gateway_model::Model, GatewayError> {
    let mut models = gateway_model::Entity::find()
        .filter(gateway_model::Column::Enabled.eq(true))
        .all(tx)
        .await
        .map_err(db_err)?;

    models.retain(|m| role_allowed(m, platform_role, tenant_role));
    models.sort_by_key(|m| {
        (
            m.tenant_id.is_some(),
            !supports_tools(m),
            m.created_at,
            m.name.clone(),
        )
    });
    models
        .into_iter()
        .next()
        .ok_or_else(|| GatewayError::ModelNotFound(AUTO_MODEL_NAME.to_string()))
}

/// 服务身份出站需要的模型能力。
///
/// 两个变体的判定口径**故意不对称**，因为 `tools` 与 `embeddings` 在这个目录里的默认值
/// 本来就相反（见 [`supports_tools`] / [`supports_embeddings`]）：
///
/// * 嵌入必须**显式声明**：把一个纯聊天模型当嵌入模型用只会拿到上游的 400/404；
/// * 聊天只有**显式关闭** `tools` 才拒绝：绝大多数模型行不写 `capabilities`，
///   若按「必须显式声明」判定，等于要求把整张模型表补一遍，而它们本来就能调工具。
///
/// 服务进程不接受「悄悄降级」：能力不足在目录这一层就说清楚，不推给上游。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceCapability {
    /// 嵌入出站。
    Embeddings,
    /// 聊天出站（agent 运行时用，需要工具调用）。
    Chat,
}

impl ServiceCapability {
    fn check(self, model: &gateway_model::Model) -> Result<(), GatewayError> {
        let missing = match self {
            Self::Embeddings if !supports_embeddings(model) => "未声明 embeddings 能力",
            Self::Chat if !supports_tools(model) => "已声明不支持工具调用",
            Self::Embeddings | Self::Chat => return Ok(()),
        };
        Err(GatewayError::BadParam(format!(
            "模型 {} {missing}",
            model.name
        )))
    }
}

/// 模型是否声明了工具调用能力；**未声明视为支持**（与客户端 opt-out 口径一致）。
fn supports_tools(model: &gateway_model::Model) -> bool {
    model
        .capabilities
        .as_ref()
        .and_then(|c| c.get("tools"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// 模型是否**显式**声明了嵌入能力。
///
/// 与 [`supports_tools`] 的默认值相反，这里未声明就是「不支持」：聊天模型全都吃
/// `tools` 字段的缺省宽松口径，而把一个纯聊天模型当成嵌入模型用只会得到上游的
/// 400/404，与其把失败推给上游，不如在目录这一层就说清楚。
fn supports_embeddings(model: &gateway_model::Model) -> bool {
    model
        .capabilities
        .as_ref()
        .and_then(|c| c.get("embeddings"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 收敛能力声明：`None` / `null` / 空对象 → 未声明；只保留 `tools/reasoning/vision` 的布尔值。
fn normalize_capabilities(raw: Option<Value>) -> Result<Option<Value>, GatewayError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let obj = raw
        .as_object()
        .ok_or_else(|| GatewayError::BadParam("capabilities 必须是对象".to_string()))?;

    let mut out = serde_json::Map::new();
    for key in ["tools", "reasoning", "vision", "embeddings"] {
        if let Some(value) = obj.get(key) {
            let flag = value.as_bool().ok_or_else(|| {
                GatewayError::BadParam(format!("capabilities.{key} 必须是布尔值"))
            })?;
            out.insert(key.to_string(), Value::Bool(flag));
        }
    }
    if out.is_empty() {
        return Ok(None);
    }
    Ok(Some(Value::Object(out)))
}

/// 上下文窗口：非正数视为「未知」（清空）。
fn normalize_context_window(raw: Option<i64>) -> Option<i64> {
    raw.filter(|v| *v > 0)
}

/// 一次性取 `providerID → 展示名`，避免逐条模型查库。
async fn provider_names(
    tx: &DatabaseTransaction,
) -> Result<std::collections::HashMap<Uuid, String>, GatewayError> {
    let providers = gateway_provider::Entity::find()
        .all(tx)
        .await
        .map_err(db_err)?;
    Ok(providers.into_iter().map(|p| (p.id, p.name)).collect())
}

async fn find_provider_name(tx: &DatabaseTransaction, provider_id: Uuid) -> Option<String> {
    gateway_provider::Entity::find_by_id(provider_id)
        .one(tx)
        .await
        .ok()
        .flatten()
        .map(|p| p.name)
}

/// 目录里的自动路由伪条目：没有 id / provider（它不对应任何一行模型）。
fn auto_model_r() -> ModelR {
    ModelR {
        id: String::new(),
        provider_id: String::new(),
        name: AUTO_MODEL_NAME.to_string(),
        label: AUTO_MODEL_LABEL.to_string(),
        allow_roles: None,
        enabled: true,
        daily_token_quota: 0,
        capabilities: Some(json!({ "tools": true, "reasoning": false, "vision": false })),
        context_window: None,
        provider_name: None,
        created_at: 0,
        updated_at: 0,
    }
}

/// 模型是否对该身份开放：`allow_roles` 未声明 / 空数组 = 所有人可用。
///
/// 角色来自 [`Principal`]（平台角色 + 当前租户角色），不再另行查库；
/// 字面量比较留在网关这一层（`allow_roles` 是网关自己的列，不是权限判定）。
fn role_allowed(
    model: &gateway_model::Model,
    platform: PlatformRole,
    tenant_role: Option<TenantRole>,
) -> bool {
    let Some(json) = model.allow_roles.as_ref() else {
        return true;
    };
    let Some(arr) = json.as_array() else {
        return true;
    };
    if arr.is_empty() {
        return true;
    }
    let roles: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
    roles.contains(&platform.as_str())
        || tenant_role.is_some_and(|role| roles.contains(&role.as_str()))
}

fn chat_url(provider: &gateway_provider::Model) -> Result<String, GatewayError> {
    endpoint_url(provider, "/chat/completions")
}

fn embeddings_url(provider: &gateway_provider::Model) -> Result<String, GatewayError> {
    endpoint_url(provider, "/embeddings")
}

/// 按供应商类型拼出站 URL + 路径。
///
/// `kind` 白名单放在这里而不是各调用点：不认识的供应商类型必须**在出站之前**拒绝，
/// 否则就会拿一个「看着像 baseURL」的字符串去发请求。
fn endpoint_url(provider: &gateway_provider::Model, path: &str) -> Result<String, GatewayError> {
    let kind = provider.kind.as_str();
    if !matches!(kind, "openai" | "deepseek" | "qwen" | "zhipu" | "ollama") {
        return Err(GatewayError::UnsupportedKind(provider.kind.clone()));
    }
    Ok(format!("{}{path}", provider.base_url.trim_end_matches('/')))
}

fn build_body(req: &ChatCompletionsP, model_name: &str, stream: bool) -> Value {
    let mut map = req.extra.clone();
    map.insert("model".to_string(), json!(model_name));
    map.insert("stream".to_string(), json!(stream));
    if stream {
        map.insert(
            "stream_options".to_string(),
            json!({ "include_usage": true }),
        );
    }
    Value::Object(map)
}

/// 嵌入请求体：`model` 一律用**令牌作用域里的**模型覆盖客户端给的字段，
/// 其余（`input`/`dimensions`/…）原样透传。
fn build_embeddings_body(req: &EmbeddingsP, model_name: &str) -> Value {
    let mut map = req.extra.clone();
    map.insert("model".to_string(), json!(model_name));
    Value::Object(map)
}

fn quota_key_for(scope: &QuotaScope) -> String {
    match scope {
        QuotaScope::User(id) => quota_key("user", id),
        QuotaScope::Tenant(id) => quota_key("tenant", id),
    }
}

// ---- 用量/审计落库 ----

/// 落库用的短作用域：按 [`CompletionMeta`] 里的身份重新申请一段事务。
///
/// 时序上落库必然发生在请求作用域结束之后（上游调用不允许被事务包住），所以不能沿用请求
/// 那个事务。两种情形各有归属：有租户记租户作用域，没租户记账号作用域——都由行级策略
/// 自约束，写不出别人的行。
enum StoreScope {
    Tenant(TenantScope),
    Account(AccountScope),
}

impl StoreScope {
    async fn open(
        storage: &Storage,
        tenant_id: Option<Uuid>,
        user_id: Uuid,
    ) -> Result<Self, sea_orm::DbErr> {
        Ok(match tenant_id {
            Some(tid) => Self::Tenant(TenantScope::open(storage, TenantId::from_uuid(tid)).await?),
            None => Self::Account(AccountScope::open(storage, UserId::from_uuid(user_id)).await?),
        })
    }

    const fn tx(&self) -> &DatabaseTransaction {
        match self {
            Self::Tenant(scope) => scope.tx(),
            Self::Account(scope) => scope.tx(),
        }
    }

    async fn commit(self) -> Result<(), sea_orm::DbErr> {
        match self {
            Self::Tenant(scope) => scope.commit().await,
            Self::Account(scope) => scope.commit().await,
        }
    }

    async fn rollback(self) -> Result<(), sea_orm::DbErr> {
        match self {
            Self::Tenant(scope) => scope.rollback().await,
            Self::Account(scope) => scope.rollback().await,
        }
    }
}

/// 一次调用结束后：累计 token 用量、落用量与审计。
///
/// 两个动作都是**尽力而为**：走到这里响应体已经发完（流式）或已经拿到上游结果，
/// 记账失败不该把一个已经成功的回答变成 500。失败只留日志。
#[allow(clippy::too_many_arguments)]
async fn record_completion(
    db: &Storage,
    redis: &RedisPool,
    config: &Configure,
    meta: &CompletionMeta,
    usage: Option<(i64, i64, i64)>,
    status: &str,
    latency_ms: i64,
    ip: Option<String>,
) {
    let (prompt, completion, total) = usage.unwrap_or((0, 0, 0));
    let input = UsageInput {
        tenant_id: meta.tenant_id,
        user_id: meta.user_id,
        provider_id: meta.provider_id,
        model_id: meta.model_id,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        status: status.to_string(),
        latency_ms,
    };

    persist(db, config, meta, &input, status, total, ip).await;

    let _ = crate::services::gateway::quota::add_tokens(redis, &meta.quota_key, total).await;
}

/// 用量与审计在同一段作用域里落下：要么都成，要么都不成（不留半截记录）。
#[allow(clippy::too_many_arguments)]
async fn persist(
    db: &Storage,
    config: &Configure,
    meta: &CompletionMeta,
    input: &UsageInput,
    status: &str,
    total: i64,
    ip: Option<String>,
) {
    let scope = match StoreScope::open(db, meta.tenant_id, meta.user_id).await {
        Ok(scope) => scope,
        Err(err) => {
            tracing::warn!(error = %err, "网关用量落库作用域不可用，跳过记账");
            return;
        }
    };

    let mut failed = record_usage(scope.tx(), input).await.is_err();
    if failed {
        tracing::warn!("网关用量落库失败");
    }
    if config.gateway_audit_enabled() {
        let audit = record_audit(
            scope.tx(),
            meta.tenant_id,
            meta.user_id,
            meta.action,
            &meta.model_name,
            Some(json!({ "status": status, "totalTokens": total })),
            ip,
        )
        .await;
        if audit.is_err() {
            tracing::warn!("网关审计落库失败");
            failed = true;
        }
    }

    let result = if failed {
        scope.rollback().await
    } else {
        scope.commit().await
    };
    if let Err(err) = result {
        tracing::warn!(error = %err, "网关用量落库收尾失败");
    }
}

struct Record {
    meta: CompletionMeta,
    db: Arc<Storage>,
    redis: Arc<RedisPool>,
    config: Arc<Configure>,
    ip: Option<String>,
    started: Instant,
    buffer: String,
    usage: Option<(i64, i64, i64)>,
    failed: bool,
}

impl Record {
    fn capture(&mut self, chunk: &[u8]) {
        self.buffer.push_str(&String::from_utf8_lossy(chunk));
        while let Some(pos) = self.buffer.find('\n') {
            let line = self.buffer[..pos].to_string();
            self.buffer.drain(..=pos);
            let line = line.trim();
            let Some(payload) = line.strip_prefix("data:") else {
                continue;
            };
            let payload = payload.trim();
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(payload) {
                if let Some(u) = v.get("usage") {
                    self.usage = Some(parse_usage_json(u));
                }
            }
        }
    }

    async fn finish(&mut self) {
        let latency = self.started.elapsed().as_millis() as i64;
        let status = if self.failed { "UPSTREAM" } else { "OK" };
        record_completion(
            &self.db,
            &self.redis,
            &self.config,
            &self.meta,
            self.usage,
            status,
            latency,
            self.ip.clone(),
        )
        .await;
    }
}

fn sse_stream(
    resp: reqwest::Response,
    record: Record,
) -> impl Stream<Item = Result<Bytes, actix_web::Error>> + 'static {
    let upstream = resp.bytes_stream();
    futures::stream::unfold(
        (upstream, record),
        |(mut upstream, mut record)| async move {
            match upstream.next().await {
                Some(Ok(chunk)) => {
                    record.capture(&chunk);
                    Some((Ok(chunk), (upstream, record)))
                }
                Some(Err(e)) => {
                    record.failed = true;
                    record.finish().await;
                    Some((
                        Err(actix_web::error::ErrorInternalServerError(e)),
                        (upstream, record),
                    ))
                }
                None => {
                    record.finish().await;
                    None
                }
            }
        },
    )
}

fn parse_usage_json(u: &Value) -> (i64, i64, i64) {
    (
        u.get("prompt_tokens").and_then(|x| x.as_i64()).unwrap_or(0),
        u.get("completion_tokens")
            .and_then(|x| x.as_i64())
            .unwrap_or(0),
        u.get("total_tokens").and_then(|x| x.as_i64()).unwrap_or(0),
    )
}

// ---- 转换 ----

fn provider_to_r(m: gateway_provider::Model) -> ProviderR {
    ProviderR {
        id: m.id.to_string(),
        kind: m.kind,
        name: m.name,
        base_url: m.base_url,
        status: m.status,
        has_api_key: !m.api_key_enc.is_empty(),
        created_at: m.created_at.timestamp_millis(),
        updated_at: m.updated_at.timestamp_millis(),
    }
}

fn model_to_r(m: gateway_model::Model, provider_name: Option<String>) -> ModelR {
    ModelR {
        id: m.id.to_string(),
        provider_id: m.provider_id.to_string(),
        name: m.name,
        label: m.label,
        allow_roles: json_to_roles(m.allow_roles.as_ref()),
        enabled: m.enabled,
        daily_token_quota: m.daily_token_quota,
        capabilities: m.capabilities,
        context_window: m.context_window,
        provider_name,
        created_at: m.created_at.timestamp_millis(),
        updated_at: m.updated_at.timestamp_millis(),
    }
}

fn usage_to_r(m: gateway_usage::Model) -> UsageR {
    UsageR {
        id: m.id.to_string(),
        tenant_id: m.tenant_id.map(|t| t.to_string()),
        user_id: m.user_id.to_string(),
        model_id: m.model_id.to_string(),
        prompt_tokens: m.prompt_tokens,
        completion_tokens: m.completion_tokens,
        total_tokens: m.total_tokens,
        status: m.status,
        latency_ms: m.latency_ms,
        created_at: m.created_at.timestamp_millis(),
    }
}

fn audit_to_r(m: gateway_audit::Model) -> AuditR {
    AuditR {
        id: m.id.to_string(),
        tenant_id: m.tenant_id.map(|t| t.to_string()),
        actor: m.actor.to_string(),
        action: m.action,
        resource: m.resource,
        detail: m.detail,
        ip: m.ip,
        created_at: m.created_at.timestamp_millis(),
    }
}

fn roles_to_json(roles: Option<Vec<String>>) -> Option<Value> {
    roles.map(|r| Value::Array(r.into_iter().map(Value::String).collect()))
}

fn json_to_roles(json: Option<&Value>) -> Option<Vec<String>> {
    json.and_then(|j| j.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    })
}

fn encrypt_api_key(config: &Configure, key: Option<&str>) -> Result<String, GatewayError> {
    match key {
        Some(k) if !k.is_empty() => {
            let aes_key = config.aes_key().ok_or(EncryptionError::InvalidKeyLength)?;
            Ok(encrypt_field(k, aes_key)?)
        }
        _ => Ok(String::new()),
    }
}

fn parse_status(value: Option<&str>) -> Result<String, GatewayError> {
    match value.unwrap_or("ACTIVE") {
        "ACTIVE" | "DISABLED" => Ok(value.unwrap_or("ACTIVE").to_string()),
        _ => Err(GatewayError::BadParam("状态无效".to_string())),
    }
}

fn validate_kind(kind: &str) -> Result<(), GatewayError> {
    match kind {
        "openai" | "anthropic" | "deepseek" | "qwen" | "zhipu" | "ollama" => Ok(()),
        _ => Err(GatewayError::BadParam("供应商类型无效".to_string())),
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, ()> {
    Uuid::parse_str(value).map_err(|_| ())
}

fn db_err(err: sea_orm::DbErr) -> GatewayError {
    GatewayError::Db(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bad_param(err: GatewayError) -> bool {
        matches!(err, GatewayError::BadParam(_))
    }

    #[test]
    fn audit_filter_parses_the_full_condition_set() {
        let filter = AuditFilter::parse(
            Some("11111111-1111-1111-1111-111111111111"),
            Some("22222222-2222-2222-2222-222222222222"),
            Some("  gateway.chat  "),
            Some(1_789_000_000_000),
            Some(1_789_000_060_000),
        )
        .expect("全部合法");
        assert_eq!(
            filter.tenant_id,
            Some(Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap())
        );
        assert_eq!(
            filter.actor,
            Some(Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap())
        );
        // 动作是精确匹配，首尾空白必须被裁掉，否则永远查不到
        assert_eq!(filter.action.as_deref(), Some("gateway.chat"));
        assert_eq!(
            filter.from.map(|t| t.timestamp_millis()),
            Some(1_789_000_000_000)
        );
        assert_eq!(
            filter.to.map(|t| t.timestamp_millis()),
            Some(1_789_000_060_000)
        );
    }

    #[test]
    fn audit_filter_treats_blank_strings_as_absent() {
        // 前端把「未选择」序列化成空串是常态，不该因此 400
        let filter =
            AuditFilter::parse(Some("  "), Some(""), Some(""), None, None).expect("空串即缺省");
        assert_eq!(filter.tenant_id, None);
        assert_eq!(filter.actor, None);
        assert_eq!(filter.action, None);
    }

    #[test]
    fn audit_filter_rejects_malformed_uuid_instead_of_ignoring_it() {
        assert!(bad_param(
            AuditFilter::parse(Some("not-a-uuid"), None, None, None, None)
                .expect_err("非法 tenantID")
        ));
        assert!(bad_param(
            AuditFilter::parse(None, Some("not-a-uuid"), None, None, None).expect_err("非法 actor")
        ));
    }

    #[test]
    fn audit_filter_rejects_reversed_and_unrepresentable_time_ranges() {
        assert!(bad_param(
            AuditFilter::parse(None, None, None, Some(2), Some(1)).expect_err("from 晚于 to")
        ));
        // from == to 是合法窗口（毫秒级排查单点事件）
        assert!(AuditFilter::parse(None, None, None, Some(7), Some(7)).is_ok());
        assert!(bad_param(
            AuditFilter::parse(None, None, None, Some(i64::MAX), None).expect_err("时间戳越界")
        ));
    }

    #[test]
    fn tenant_filter_accepts_only_the_path_tenant() {
        let tenant =
            TenantId::from_uuid(Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap());

        // 与路径一致（含空白）→ 通过，但过滤条件里不保留租户项：可见性归作用域
        let filter = AuditFilter::parse_for_tenant(
            tenant,
            Some("  11111111-1111-1111-1111-111111111111  "),
            None,
            Some("gateway.chat"),
            None,
            None,
        )
        .expect("与路径一致即合法");
        assert_eq!(filter.tenant_id, None);
        assert_eq!(filter.action.as_deref(), Some("gateway.chat"));

        // 缺省同样通过
        assert!(AuditFilter::parse_for_tenant(tenant, None, None, None, None, None).is_ok());

        // 指向别的租户 → 400，而不是「静默只给本租户的行」
        assert!(bad_param(
            AuditFilter::parse_for_tenant(
                tenant,
                Some("33333333-3333-3333-3333-333333333333"),
                None,
                None,
                None,
                None
            )
            .expect_err("跨租户 tenantID")
        ));
        assert!(bad_param(
            AuditFilter::parse_for_tenant(tenant, Some("not-a-uuid"), None, None, None, None)
                .expect_err("非法 tenantID")
        ));
    }

    #[test]
    fn export_cap_reports_truncation_only_when_rows_exceed_it() {
        // 少于上限：原样返回
        let (rows, truncated) = cap_rows(vec![1, 2, 3], 5);
        assert_eq!(rows, vec![1, 2, 3]);
        assert!(!truncated);

        // **正好取满**：不算截断。这一条是「多取一行」的存在理由——
        // 只看 len == cap 会把取满误报成截断，让运维去追一个不存在的窗口。
        let (rows, truncated) = cap_rows(vec![1, 2, 3, 4, 5], 5);
        assert_eq!(rows, vec![1, 2, 3, 4, 5]);
        assert!(!truncated);

        // 多取到的那一行即「还有更多」：截断，且丢掉尾巴（保留最新）
        let (rows, truncated) = cap_rows(vec![1, 2, 3, 4, 5, 6], 5);
        assert_eq!(rows, vec![1, 2, 3, 4, 5]);
        assert!(truncated);
    }

    #[test]
    fn export_window_defaults_to_the_last_thirty_days() {
        let filter = AuditFilter::parse(None, None, None, None, Some(1_789_000_000_000))
            .expect("合法")
            .with_default_window();
        assert_eq!(
            filter.to.map(|t| t.timestamp_millis()),
            Some(1_789_000_000_000)
        );
        assert_eq!(
            filter.from.map(|t| t.timestamp_millis()),
            Some(1_789_000_000_000 - 30 * 24 * 60 * 60 * 1000)
        );
    }

    #[test]
    fn export_window_keeps_an_explicit_range_untouched() {
        let filter = AuditFilter::parse(
            None,
            None,
            None,
            Some(1_700_000_000_000),
            Some(1_700_000_001_000),
        )
        .expect("合法")
        .with_default_window();
        assert_eq!(
            filter.from.map(|t| t.timestamp_millis()),
            Some(1_700_000_000_000)
        );
        assert_eq!(
            filter.to.map(|t| t.timestamp_millis()),
            Some(1_700_000_001_000)
        );
    }
}
