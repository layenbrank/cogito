//! 租户与成员的业务编排。
//!
//! 读写一律发生在**已进入作用域**的事务里（租户内的走 [`TenantCtx`]，账号级的走
//! [`AccountScope`]），查询条件里不再出现 `tenantID = ?`：作用域由守卫建立、行级安全兜底。
//! 这里只做三件事——把 wire 入参解析成领域入参、把领域结果映射成 wire 出参、
//! 把失败翻译成契约错误码；「能不能做」交给 `authz`。

use std::collections::HashMap;

use authz::{Action, Permission, Resource};
use entity::auth;
use identity::tenant::{
    self as tenants, Member, MemberChanges, Tenant as TenantRecord, TenantChanges, TenantDraft,
    TenantQuery, TenantType,
};
use identity::{AccountStatus, PersistError, TenantId, TenantRole, UserId};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::filters::exception::Exception;
use crate::guards::account::AccountScope;
use crate::guards::platform::PlatformScope;
use crate::guards::tenant::TenantCtx;
use crate::interceptors::envelope::Paginated;
use crate::services::gateway::schema::{AuditFilter, AuditR};
use crate::services::gateway::service::GatewayService;
use crate::services::subscription::schema::{QuotaR, SubscribeP, SubscriptionR};
use crate::services::subscription::service::SubscriptionService;
use crate::services::tenant::schema::{
    AdminTenantQueryP, MemberR, MemberUpdateP, MemberWriteP, TenantDetailR, TenantR,
    TenantSummaryR, TenantUpdateP, TenantWriteP, UserTenantR,
};
use crate::utils::code::{auth as auth_codes, business, external, request, resource};
use crate::utils::db::is_unique_violation;

/// 读租户本身（成员均可）。
const READ_TENANT: Permission = Permission::new(Resource::Tenant, Action::Read);
/// 管理租户本身（改名、停用、删除）：仅 Owner。
const MANAGE_TENANT: Permission = Permission::new(Resource::Tenant, Action::Manage);
/// 读成员名单（成员均可）。
const READ_MEMBER: Permission = Permission::new(Resource::Member, Action::Read);
/// 增改成员：Owner / Admin。
const WRITE_MEMBER: Permission = Permission::new(Resource::Member, Action::Write);
/// 移除成员：Owner / Admin。
const DELETE_MEMBER: Permission = Permission::new(Resource::Member, Action::Delete);

#[derive(Debug, thiserror::Error)]
pub enum TenantError {
    #[error("Tenant not found")]
    NotFound,
    #[error("Slug already exists")]
    SlugTaken,
    #[error("User not found")]
    UserNotFound,
    #[error("Already a member")]
    AlreadyMember,
    #[error("Not a member")]
    NotMember,
    #[error("Insufficient permission")]
    Forbidden,
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Database error: {0}")]
    Db(String),
}

impl From<TenantError> for Exception {
    fn from(err: TenantError) -> Self {
        match err {
            TenantError::NotFound => Exception::custom(resource::NOT_FOUND, "租户不存在"),
            TenantError::SlugTaken => Exception::custom(resource::ALREADY_EXISTS, "租户标识已存在"),
            TenantError::UserNotFound => Exception::custom(business::user::NOT_FOUND, "用户不存在"),
            TenantError::AlreadyMember => {
                Exception::custom(resource::ALREADY_EXISTS, "该用户已是成员")
            }
            TenantError::NotMember => Exception::custom(auth_codes::ACCESS_DENIED, "非租户成员"),
            TenantError::Forbidden => {
                Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "权限不足")
            }
            TenantError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            TenantError::Db(msg) => {
                tracing::error!(error = %msg, "tenant database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

pub struct TenantService;

impl TenantService {
    /// 新建租户：调用者是它的 Owner。
    ///
    /// 标识由调用方生成并已写进作用域，这里直接用——租户行与首条成员关系都必须落在
    /// 当前作用域内，因此两者由 `identity` 一起写。
    pub async fn create(ctx: &TenantCtx, req: TenantWriteP) -> Result<TenantR, TenantError> {
        let name = normalized_name(&req.name)?;
        let slug = normalized_slug(&req.slug)?;
        let tenant_type = match req.r#type.as_deref() {
            Some(value) => parse_tenant_type(value)?,
            None => TenantType::Personal,
        };

        let draft = TenantDraft {
            id: ctx.tenant_id(),
            name,
            slug,
            tenant_type,
        };
        let tenant = tenants::create_owned(ctx.tx(), draft, ctx.principal().user_id())
            .await
            .map_err(|err| conflict(err, TenantError::SlugTaken))?;

        Ok(tenant_to_r(&tenant))
    }

    /// 我参与的有效成员关系覆盖到的租户（账号作用域，跨租户只读）。
    ///
    /// 还没有选定租户，因此走 [`AccountScope`]：成员表只放行自己的行，租户表只放行
    /// 「我是其有效成员」的行。作用域由 Controller 开、只读结束即回滚。
    pub async fn list(scope: &AccountScope) -> Result<Vec<TenantR>, TenantError> {
        let tenants = tenants::list_for_user(scope.tx(), scope.user_id())
            .await
            .map_err(persist_err)?;

        Ok(tenants.iter().map(tenant_to_r).collect())
    }

    /// 读租户本身。
    pub async fn get(ctx: &TenantCtx) -> Result<TenantR, TenantError> {
        authorize(ctx, READ_TENANT)?;
        let tenant = tenants::find(ctx.tx(), ctx.tenant_id())
            .await
            .map_err(persist_err)?
            .ok_or(TenantError::NotFound)?;

        Ok(tenant_to_r(&tenant))
    }

    /// 改租户本身：仅 Owner。
    pub async fn update(ctx: &TenantCtx, req: TenantUpdateP) -> Result<TenantR, TenantError> {
        authorize(ctx, MANAGE_TENANT)?;
        let changes = TenantChanges {
            name: req.name.as_deref().map(normalized_name).transpose()?,
            status: req.status.as_deref().map(parse_status).transpose()?,
            tenant_type: req.r#type.as_deref().map(parse_tenant_type).transpose()?,
        };

        let tenant = tenants::update(
            ctx.tx(),
            ctx.tenant_id(),
            changes,
            ctx.principal().user_id(),
        )
        .await
        .map_err(persist_err)?
        .ok_or(TenantError::NotFound)?;

        Ok(tenant_to_r(&tenant))
    }

    /// 删除租户：仅 Owner。成员关系随外键级联删除。
    pub async fn remove(ctx: &TenantCtx) -> Result<(), TenantError> {
        authorize(ctx, MANAGE_TENANT)?;
        let removed = tenants::delete(ctx.tx(), ctx.tenant_id())
            .await
            .map_err(persist_err)?;

        if removed {
            Ok(())
        } else {
            Err(TenantError::NotFound)
        }
    }

    /// 成员名单（含已停用成员）；附带 username / email 展示字段。
    pub async fn list_members(ctx: &TenantCtx) -> Result<Vec<MemberR>, TenantError> {
        authorize(ctx, READ_MEMBER)?;
        let members = tenants::members(ctx.tx(), ctx.tenant_id())
            .await
            .map_err(persist_err)?;

        enrich_members(ctx.tx(), &members).await
    }

    /// 新增成员：账号必须存在，重复成员由唯一索引拒绝。
    pub async fn add_member(ctx: &TenantCtx, req: MemberWriteP) -> Result<MemberR, TenantError> {
        authorize(ctx, WRITE_MEMBER)?;
        let user = parse_user_id(&req.user_id)?;
        let role = parse_role(&req.role)?;

        let account = identity::persistence::find_account(ctx.tx(), user)
            .await
            .map_err(persist_err)?;
        if account.is_none() {
            return Err(TenantError::UserNotFound);
        }

        let member = tenants::add_member(
            ctx.tx(),
            ctx.tenant_id(),
            user,
            role,
            ctx.principal().user_id(),
        )
        .await
        .map_err(|err| conflict(err, TenantError::AlreadyMember))?;

        enrich_member(ctx.tx(), &member).await
    }

    /// 改成员的角色或状态。
    pub async fn update_member(
        ctx: &TenantCtx,
        user: UserId,
        req: MemberUpdateP,
    ) -> Result<MemberR, TenantError> {
        authorize(ctx, WRITE_MEMBER)?;
        let changes = MemberChanges {
            role: req.role.as_deref().map(parse_role).transpose()?,
            status: req.status.as_deref().map(parse_status).transpose()?,
        };

        let member = tenants::update_member(
            ctx.tx(),
            ctx.tenant_id(),
            user,
            changes,
            ctx.principal().user_id(),
        )
        .await
        .map_err(persist_err)?
        .ok_or(TenantError::NotFound)?;

        enrich_member(ctx.tx(), &member).await
    }

    // ---------- 平台运维面（PlatformScope / Auth::admin） ----------

    /// 平台全量租户列表（分页 / 搜索）。
    pub async fn admin_list(
        scope: &PlatformScope,
        query: AdminTenantQueryP,
    ) -> Result<Paginated<TenantSummaryR>, TenantError> {
        let (page, size, skip) = page_bounds(query.page, query.size)?;
        let domain_query = TenantQuery {
            q: query.q,
            status: query.status.as_deref().map(parse_status).transpose()?,
            tenant_type: query
                .tenant_type
                .as_deref()
                .map(parse_tenant_type)
                .transpose()?,
            skip,
            take: size as u64,
        };
        let (tenants, total) = tenants::list_all(scope.tx(), &domain_query)
            .await
            .map_err(persist_err)?;
        let counts = tenants::count_members_many(
            scope.tx(),
            &tenants.iter().map(|t| t.id()).collect::<Vec<_>>(),
        )
        .await
        .map_err(persist_err)?;

        let items = tenants
            .iter()
            .map(|tenant| {
                let member_count = counts.get(&tenant.id().as_uuid()).copied().unwrap_or(0);
                TenantSummaryR {
                    id: tenant.id().to_string(),
                    name: tenant.name().to_owned(),
                    slug: tenant.slug().to_owned(),
                    status: tenant.status().as_str().to_owned(),
                    r#type: tenant.tenant_type().as_str().to_owned(),
                    member_count,
                    created_at: tenant.created_at_ms(),
                    updated_at: tenant.updated_at_ms(),
                }
            })
            .collect();

        Ok(Paginated::new(items, total, page, size))
    }

    /// 平台租户详情：租户 + 成员（含展示字段）+ 订阅历史 + 配额 + 近期审计。
    pub async fn admin_detail(
        ctx: &TenantCtx,
        config: &Configure,
        redis: &RedisPool,
    ) -> Result<TenantDetailR, Exception> {
        authorize(ctx, READ_TENANT).map_err(Exception::from)?;
        let tenant = tenants::find(ctx.tx(), ctx.tenant_id())
            .await
            .map_err(persist_err)
            .map_err(Exception::from)?
            .ok_or_else(|| Exception::from(TenantError::NotFound))?;
        let members = tenants::members(ctx.tx(), ctx.tenant_id())
            .await
            .map_err(persist_err)
            .map_err(Exception::from)?;
        let enriched = enrich_members(ctx.tx(), &members)
            .await
            .map_err(Exception::from)?;
        let subscriptions = SubscriptionService::list(ctx).await?;
        let quota = match SubscriptionService::quota(ctx, config, redis).await {
            Ok(item) => Some(item),
            Err(err) => {
                tracing::warn!(error = %err, "admin tenant quota unavailable");
                None
            }
        };
        let recent_audit = load_recent_audit(ctx).await;

        Ok(TenantDetailR {
            id: tenant.id().to_string(),
            name: tenant.name().to_owned(),
            slug: tenant.slug().to_owned(),
            status: tenant.status().as_str().to_owned(),
            r#type: tenant.tenant_type().as_str().to_owned(),
            member_count: enriched.len() as u64,
            created_at: tenant.created_at_ms(),
            updated_at: tenant.updated_at_ms(),
            members: enriched,
            subscriptions,
            quota,
            recent_audit,
        })
    }

    /// 平台代开 / 续订订阅（可信通道 `grant`；不造计费，只写档位）。
    pub async fn admin_grant_subscription(
        ctx: &TenantCtx,
        config: &Configure,
        redis: &RedisPool,
        req: SubscribeP,
    ) -> Result<SubscriptionR, Exception> {
        // 与租户 Manage 对齐：仅平台 ADMIN（authz 旁路）或租户 OWNER 可代开
        authorize(ctx, MANAGE_TENANT).map_err(Exception::from)?;
        SubscriptionService::grant(ctx.scope(), config, redis, ctx.principal().user_id(), req)
            .await
            .map_err(Exception::from)
    }

    /// 平台只读：订阅历史（复用租户面 list，会惰性标 EXPIRED）。
    pub async fn admin_list_subscriptions(ctx: &TenantCtx) -> Result<Vec<SubscriptionR>, Exception> {
        authorize(ctx, READ_TENANT).map_err(Exception::from)?;
        SubscriptionService::list(ctx).await
    }

    /// 平台只读：当前配额快照。
    pub async fn admin_quota(
        ctx: &TenantCtx,
        config: &Configure,
        redis: &RedisPool,
    ) -> Result<QuotaR, Exception> {
        authorize(ctx, READ_TENANT).map_err(Exception::from)?;
        SubscriptionService::quota(ctx, config, redis).await
    }

    /// 某用户所属的全部租户（含成员角色）；须在特权作用域内。
    pub async fn admin_tenants_of_user(
        scope: &PlatformScope,
        user: UserId,
    ) -> Result<Vec<UserTenantR>, TenantError> {
        let account = identity::persistence::find_account(scope.tx(), user)
            .await
            .map_err(persist_err)?;
        if account.is_none() {
            return Err(TenantError::UserNotFound);
        }

        let memberships = tenants::memberships_of_user(scope.tx(), user)
            .await
            .map_err(persist_err)?;
        if memberships.is_empty() {
            return Ok(Vec::new());
        }

        let tenant_ids: Vec<TenantId> = memberships.iter().map(|m| m.tenant_id()).collect();
        let tenants = tenants::find_many(scope.tx(), &tenant_ids)
            .await
            .map_err(persist_err)?;
        let by_id: HashMap<Uuid, &TenantRecord> = tenants
            .iter()
            .map(|tenant| (tenant.id().as_uuid(), tenant))
            .collect();

        let mut rows = Vec::with_capacity(memberships.len());
        for member in &memberships {
            let Some(tenant) = by_id.get(&member.tenant_id().as_uuid()) else {
                continue;
            };
            rows.push(UserTenantR {
                tenant_id: tenant.id().to_string(),
                name: tenant.name().to_owned(),
                slug: tenant.slug().to_owned(),
                status: tenant.status().as_str().to_owned(),
                r#type: tenant.tenant_type().as_str().to_owned(),
                role: member.role().as_str().to_owned(),
                member_status: member.status().as_str().to_owned(),
            });
        }
        Ok(rows)
    }

    /// 移除成员。
    pub async fn remove_member(ctx: &TenantCtx, user: UserId) -> Result<(), TenantError> {
        authorize(ctx, DELETE_MEMBER)?;
        let removed = tenants::remove_member(ctx.tx(), ctx.tenant_id(), user)
            .await
            .map_err(persist_err)?;

        if removed {
            Ok(())
        } else {
            Err(TenantError::NotFound)
        }
    }
}

/// 权限判定：`authz` 拒绝一律 403（判定原因已由守卫记入日志）。
fn authorize(ctx: &TenantCtx, permission: Permission) -> Result<(), TenantError> {
    ctx.require(permission).map_err(|_| TenantError::Forbidden)
}

fn tenant_to_r(tenant: &TenantRecord) -> TenantR {
    TenantR {
        id: tenant.id().to_string(),
        name: tenant.name().to_owned(),
        slug: tenant.slug().to_owned(),
        status: tenant.status().as_str().to_owned(),
        r#type: tenant.tenant_type().as_str().to_owned(),
        created_at: tenant.created_at_ms(),
        updated_at: tenant.updated_at_ms(),
    }
}

fn member_to_r(member: &Member, username: Option<String>, email: Option<String>) -> MemberR {
    MemberR {
        id: member.row_id().to_string(),
        tenant_id: member.tenant_id().to_string(),
        user_id: member.user_id().to_string(),
        role: member.role().as_str().to_owned(),
        status: member.status().as_str().to_owned(),
        username,
        email,
    }
}

async fn enrich_members<C: ConnectionTrait>(
    conn: &C,
    members: &[Member],
) -> Result<Vec<MemberR>, TenantError> {
    if members.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = members.iter().map(|m| m.user_id().as_uuid()).collect();
    let accounts = auth::Entity::find()
        .filter(auth::Column::Id.is_in(ids))
        .all(conn)
        .await
        .map_err(|err| TenantError::Db(err.to_string()))?;
    let by_id: HashMap<Uuid, auth::Model> =
        accounts.into_iter().map(|row| (row.id, row)).collect();

    Ok(members
        .iter()
        .map(|member| {
            let account = by_id.get(&member.user_id().as_uuid());
            member_to_r(
                member,
                account.map(|a| a.username.clone()),
                account.and_then(|a| a.email.clone()),
            )
        })
        .collect())
}

async fn enrich_member<C: ConnectionTrait>(
    conn: &C,
    member: &Member,
) -> Result<MemberR, TenantError> {
    let mut rows = enrich_members(conn, std::slice::from_ref(member)).await?;
    Ok(rows.pop().unwrap_or_else(|| member_to_r(member, None, None)))
}

async fn load_recent_audit(ctx: &TenantCtx) -> Vec<AuditR> {
    let Ok(filter) =
        AuditFilter::parse_for_tenant(ctx.tenant_id(), None, None, None, None, None)
    else {
        return Vec::new();
    };
    match GatewayService::list_audit_in_tenant(ctx, filter, 1, 20).await {
        Ok((items, _)) => items,
        Err(err) => {
            tracing::warn!(error = %err, "admin tenant recent audit unavailable");
            Vec::new()
        }
    }
}

fn page_bounds(page: Option<u32>, size: Option<u32>) -> Result<(u32, u32, u64), TenantError> {
    let page = page.unwrap_or(1).max(1);
    let size = size.unwrap_or(50).clamp(1, 100);
    let skip = u64::from(page.saturating_sub(1)) * u64::from(size);
    Ok((page, size, skip))
}

/// 租户名称：去空白，空即拒绝。
fn normalized_name(value: &str) -> Result<String, TenantError> {
    let name = value.trim();
    if name.is_empty() {
        return Err(TenantError::BadParam("租户名称不能为空".to_string()));
    }

    Ok(name.to_owned())
}

/// 租户标识：去空白 + 转小写，只允许小写字母 / 数字 / 中划线。
fn normalized_slug(value: &str) -> Result<String, TenantError> {
    let slug = value.trim().to_ascii_lowercase();
    let valid = !slug.is_empty()
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valid {
        Ok(slug)
    } else {
        Err(TenantError::BadParam(
            "租户标识须为小写字母/数字/中划线".to_string(),
        ))
    }
}

fn parse_role(value: &str) -> Result<TenantRole, TenantError> {
    value
        .parse::<TenantRole>()
        .map_err(|_| TenantError::BadParam("角色无效".to_string()))
}

fn parse_status(value: &str) -> Result<AccountStatus, TenantError> {
    value
        .parse::<AccountStatus>()
        .map_err(|_| TenantError::BadParam("状态无效".to_string()))
}

fn parse_tenant_type(value: &str) -> Result<TenantType, TenantError> {
    value
        .parse::<TenantType>()
        .map_err(|_| TenantError::BadParam("租户类型无效".to_string()))
}

fn parse_user_id(value: &str) -> Result<UserId, TenantError> {
    value
        .parse::<UserId>()
        .map_err(|_| TenantError::BadParam("用户 ID 无效".to_string()))
}

/// 身份数据不可读（500）；字面量识别不了也走这里，不降级成「不是成员」。
fn persist_err(err: PersistError) -> TenantError {
    TenantError::Db(err.to_string())
}

/// 唯一索引冲突归为 `taken`，其余仍是 500。
fn conflict(err: PersistError, taken: TenantError) -> TenantError {
    match err {
        PersistError::Db(db) if is_unique_violation(&db) => taken,
        other => persist_err(other),
    }
}
