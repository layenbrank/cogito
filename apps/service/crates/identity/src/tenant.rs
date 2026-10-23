//! 租户与租户成员关系（`tenant` / `tenant_member` 表的读写）。
//!
//! 两张表都受行级安全约束：调用方必须传入**已进入租户作用域**的事务
//! （`Storage::tenant_tx`），未进入作用域时读不到行、写入被策略拒绝（fail-closed）。
//! 这里只读写事实：能不能做由 `authz` 判定，wire 类型的解析属于 `cogito`。

use std::{fmt, str::FromStr};

use chrono::Utc;
use entity::{tenant, tenant_member};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Set,
};
use uuid::Uuid;

use crate::persistence::{PersistError, account_status_of, tenant_role_of, unknown};
use crate::{AccountStatus, TenantId, TenantRole, UnknownRole, UserId, parse_literal};

/// 租户类型（`tenant.type`）。
///
/// `PERSONAL` 走免费/订阅档位，`TEAM` 走全局兜底；未知字面量一律拒绝，不猜。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TenantType {
    /// 个人租户。
    Personal,
    /// 团队租户。
    Team,
}

impl TenantType {
    /// 数据库存储字面量。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "PERSONAL",
            Self::Team => "TEAM",
        }
    }

    /// 全部类型，用于解析与遍历。
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[Self::Personal, Self::Team]
    }

    /// 是否为个人租户（走免费/订阅档位）。
    #[must_use]
    pub const fn is_personal(self) -> bool {
        matches!(self, Self::Personal)
    }
}

impl FromStr for TenantType {
    type Err = UnknownRole;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        parse_literal(value, Self::all().iter().map(|kind| (kind.as_str(), *kind)))
    }
}

impl fmt::Display for TenantType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 租户快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tenant {
    id: TenantId,
    name: String,
    slug: String,
    status: AccountStatus,
    tenant_type: TenantType,
    created_at_ms: i64,
    updated_at_ms: i64,
}

impl Tenant {
    /// 租户标识。
    #[must_use]
    pub const fn id(&self) -> TenantId {
        self.id
    }

    /// 租户名称。
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// 唯一标识（slug）。
    #[must_use]
    pub fn slug(&self) -> &str {
        &self.slug
    }

    /// 租户状态。
    #[must_use]
    pub const fn status(&self) -> AccountStatus {
        self.status
    }

    /// 租户类型。
    #[must_use]
    pub const fn tenant_type(&self) -> TenantType {
        self.tenant_type
    }

    /// 创建时间（Unix 毫秒）。
    #[must_use]
    pub const fn created_at_ms(&self) -> i64 {
        self.created_at_ms
    }

    /// 更新时间（Unix 毫秒）。
    #[must_use]
    pub const fn updated_at_ms(&self) -> i64 {
        self.updated_at_ms
    }
}

/// 租户成员快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    row_id: Uuid,
    tenant_id: TenantId,
    user_id: UserId,
    role: TenantRole,
    status: AccountStatus,
}

impl Member {
    /// 成员关系行标识。
    #[must_use]
    pub const fn row_id(&self) -> Uuid {
        self.row_id
    }

    /// 所属租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.tenant_id
    }

    /// 成员账号。
    #[must_use]
    pub const fn user_id(&self) -> UserId {
        self.user_id
    }

    /// 租户内角色。
    #[must_use]
    pub const fn role(&self) -> TenantRole {
        self.role
    }

    /// 成员状态。
    #[must_use]
    pub const fn status(&self) -> AccountStatus {
        self.status
    }
}

/// 新建租户的入参。
///
/// 标识由调用方生成：创建租户时要先把作用域切到该标识上（`tenant` 与 `tenant_member`
/// 的策略都要求写入行落在当前作用域内），因此标识必须先于写入确定。
pub struct TenantDraft {
    /// 租户标识。
    pub id: TenantId,
    /// 租户名称。
    pub name: String,
    /// 唯一标识（调用方已完成规范化与校验）。
    pub slug: String,
    /// 租户类型。
    pub tenant_type: TenantType,
}

/// 租户可变更字段；`None` 表示不改。
#[derive(Debug, Default, Clone)]
pub struct TenantChanges {
    /// 名称。
    pub name: Option<String>,
    /// 状态。
    pub status: Option<AccountStatus>,
    /// 类型。
    pub tenant_type: Option<TenantType>,
}

/// 成员可变更字段；`None` 表示不改。
#[derive(Debug, Default, Clone)]
pub struct MemberChanges {
    /// 租户内角色。
    pub role: Option<TenantRole>,
    /// 成员状态。
    pub status: Option<AccountStatus>,
}

/// 新建租户，并把创建者写成它的 `OWNER`。
///
/// 两行必须一起写：「租户 + 首条成员关系」构成同一个聚合，任何一步失败都不该留下
/// 没有所有者的租户。`slug` 冲突由唯一索引拒绝（调用方按 `23505` 归类）。
pub async fn create_owned<C: ConnectionTrait>(
    conn: &C,
    draft: TenantDraft,
    actor: UserId,
) -> Result<Tenant, PersistError> {
    let tenant = create(conn, draft, actor).await?;
    add_member(conn, tenant.id(), actor, TenantRole::Owner, actor).await?;
    Ok(tenant)
}

/// 写入租户行；调用方见 [`create_owned`]。
async fn create<C: ConnectionTrait>(
    conn: &C,
    draft: TenantDraft,
    actor: UserId,
) -> Result<Tenant, PersistError> {
    let now = Utc::now().fixed_offset();
    let model = tenant::ActiveModel {
        id: Set(draft.id.as_uuid()),
        name: Set(draft.name),
        slug: Set(draft.slug),
        status: Set(AccountStatus::Active.as_str().to_owned()),
        tenant_type: Set(draft.tenant_type.as_str().to_owned()),
        archived_at: Set(None),
        created_at: Set(now),
        creator: Set(Some(actor.as_uuid())),
        updated_at: Set(now),
        updater: Set(Some(actor.as_uuid())),
        expires_at: Set(None),
    }
    .insert(conn)
    .await?;

    tenant_from_model(model)
}

/// 读取租户；不可见（不存在或不在作用域内）返回 `None`。
pub async fn find<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
) -> Result<Option<Tenant>, PersistError> {
    let model = tenant::Entity::find_by_id(tenant.as_uuid())
        .one(conn)
        .await?;
    model.map(tenant_from_model).transpose()
}

/// 读取账号**有效成员关系**覆盖到的租户（`tenant_member.status = ACTIVE`）。
///
/// 必须在账号作用域事务（`Storage::user_tx`）内调用：成员表只放行自己的行，
/// 租户表也只放行「我是其有效成员」的行，因此一条查询即可跨租户读取。
pub async fn list_for_user<C: ConnectionTrait>(
    conn: &C,
    user: UserId,
) -> Result<Vec<Tenant>, PersistError> {
    let tenant_ids: Vec<Uuid> = tenant_member::Entity::find()
        .filter(tenant_member::Column::UserId.eq(user.as_uuid()))
        .filter(tenant_member::Column::Status.eq(AccountStatus::Active.as_str()))
        .all(conn)
        .await?
        .into_iter()
        .map(|member| member.tenant_id)
        .collect();

    if tenant_ids.is_empty() {
        return Ok(Vec::new());
    }

    let models = tenant::Entity::find()
        .filter(tenant::Column::Id.is_in(tenant_ids))
        .order_by_asc(tenant::Column::CreatedAt)
        .all(conn)
        .await?;

    models.into_iter().map(tenant_from_model).collect()
}

/// 平台运维面：跨租户列出租户（须在 [`PlatformScope`](crate) / `BYPASSRLS` 事务内调用）。
///
/// `q` 对 `name` / `slug` 做大小写不敏感模糊匹配；`skip` / `take` 控制分页。
pub struct TenantQuery {
    /// 名称或 slug 关键字。
    pub q: Option<String>,
    /// 状态过滤。
    pub status: Option<AccountStatus>,
    /// 类型过滤。
    pub tenant_type: Option<TenantType>,
    /// 偏移。
    pub skip: u64,
    /// 每页条数（调用方已夹紧）。
    pub take: u64,
}

/// 平台全量列表；返回本页与总数。
pub async fn list_all<C: ConnectionTrait>(
    conn: &C,
    query: &TenantQuery,
) -> Result<(Vec<Tenant>, u64), PersistError> {
    let mut select = tenant::Entity::find();
    if let Some(status) = query.status {
        select = select.filter(tenant::Column::Status.eq(status.as_str()));
    }
    if let Some(kind) = query.tenant_type {
        select = select.filter(tenant::Column::TenantType.eq(kind.as_str()));
    }
    if let Some(raw) = query.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let pattern = format!("%{raw}%");
        select = select.filter(
            Condition::any()
                .add(tenant::Column::Name.like(&pattern))
                .add(tenant::Column::Slug.like(&pattern)),
        );
    }

    let total = select.clone().count(conn).await?;
    let models = select
        .order_by_desc(tenant::Column::CreatedAt)
        .offset(query.skip)
        .limit(query.take)
        .all(conn)
        .await?;

    let tenants = models
        .into_iter()
        .map(tenant_from_model)
        .collect::<Result<Vec<_>, _>>()?;
    Ok((tenants, total))
}

/// 统计某租户的成员行数（含已停用）。
pub async fn count_members<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
) -> Result<u64, PersistError> {
    let count = tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.eq(tenant.as_uuid()))
        .count(conn)
        .await?;
    Ok(count)
}

/// 批量统计多个租户的成员数；返回 `tenantID → count`。
pub async fn count_members_many<C: ConnectionTrait>(
    conn: &C,
    tenants: &[TenantId],
) -> Result<std::collections::HashMap<Uuid, u64>, PersistError> {
    let mut map = std::collections::HashMap::new();
    if tenants.is_empty() {
        return Ok(map);
    }
    let ids: Vec<Uuid> = tenants.iter().map(|id| id.as_uuid()).collect();
    let rows = tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.is_in(ids))
        .all(conn)
        .await?;
    for row in rows {
        *map.entry(row.tenant_id).or_insert(0) += 1;
    }
    Ok(map)
}

/// 某账号在所有租户上的成员关系（含停用）；须在特权作用域内调用才能跨租户读全。
pub async fn memberships_of_user<C: ConnectionTrait>(
    conn: &C,
    user: UserId,
) -> Result<Vec<Member>, PersistError> {
    let models = tenant_member::Entity::find()
        .filter(tenant_member::Column::UserId.eq(user.as_uuid()))
        .order_by_asc(tenant_member::Column::CreatedAt)
        .all(conn)
        .await?;

    models.into_iter().map(member_from_model).collect()
}

/// 按标识批量读租户；不可见的跳过。
pub async fn find_many<C: ConnectionTrait>(
    conn: &C,
    tenants: &[TenantId],
) -> Result<Vec<Tenant>, PersistError> {
    if tenants.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = tenants.iter().map(|id| id.as_uuid()).collect();
    let models = tenant::Entity::find()
        .filter(tenant::Column::Id.is_in(ids))
        .order_by_asc(tenant::Column::CreatedAt)
        .all(conn)
        .await?;
    models.into_iter().map(tenant_from_model).collect()
}

/// 修改租户；不可见（不存在或不在作用域内）返回 `None`。
pub async fn update<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
    changes: TenantChanges,
    actor: UserId,
) -> Result<Option<Tenant>, PersistError> {
    let Some(model) = tenant::Entity::find_by_id(tenant.as_uuid())
        .one(conn)
        .await?
    else {
        return Ok(None);
    };

    let mut active: tenant::ActiveModel = model.into();
    if let Some(name) = changes.name {
        active.name = Set(name);
    }
    if let Some(status) = changes.status {
        active.status = Set(status.as_str().to_owned());
    }
    if let Some(kind) = changes.tenant_type {
        active.tenant_type = Set(kind.as_str().to_owned());
    }
    active.updated_at = Set(Utc::now().fixed_offset());
    active.updater = Set(Some(actor.as_uuid()));

    let updated = active.update(conn).await?;
    tenant_from_model(updated).map(Some)
}

/// 删除租户（成员关系随外键级联删除）；是否删掉了返回布尔。
pub async fn delete<C: ConnectionTrait>(conn: &C, tenant: TenantId) -> Result<bool, PersistError> {
    let result = tenant::Entity::delete_by_id(tenant.as_uuid())
        .exec(conn)
        .await?;
    Ok(result.rows_affected > 0)
}

/// 读取租户的全部成员关系（含已停用成员）。
pub async fn members<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
) -> Result<Vec<Member>, PersistError> {
    let models = tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.eq(tenant.as_uuid()))
        .order_by_asc(tenant_member::Column::CreatedAt)
        .all(conn)
        .await?;

    models.into_iter().map(member_from_model).collect()
}

/// 读取指定账号在租户内的成员关系，不区分状态；不是成员返回 `None`。
pub async fn find_member<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
    user: UserId,
) -> Result<Option<Member>, PersistError> {
    let model = member_query(tenant, user).one(conn).await?;
    model.map(member_from_model).transpose()
}

/// 新增成员关系；主键冲突由索引拒绝（调用方按 `23505` 归类为「已是成员」）。
pub async fn add_member<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
    user: UserId,
    role: TenantRole,
    actor: UserId,
) -> Result<Member, PersistError> {
    let now = Utc::now().fixed_offset();
    let model = tenant_member::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(tenant.as_uuid()),
        user_id: Set(user.as_uuid()),
        role: Set(role.as_str().to_owned()),
        status: Set(AccountStatus::Active.as_str().to_owned()),
        archived_at: Set(None),
        created_at: Set(now),
        creator: Set(Some(actor.as_uuid())),
        updated_at: Set(now),
        updater: Set(Some(actor.as_uuid())),
        expires_at: Set(None),
    }
    .insert(conn)
    .await?;

    member_from_model(model)
}

/// 修改成员关系；不是成员返回 `None`。
pub async fn update_member<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
    user: UserId,
    changes: MemberChanges,
    actor: UserId,
) -> Result<Option<Member>, PersistError> {
    let Some(model) = member_query(tenant, user).one(conn).await? else {
        return Ok(None);
    };

    let mut active: tenant_member::ActiveModel = model.into();
    if let Some(role) = changes.role {
        active.role = Set(role.as_str().to_owned());
    }
    if let Some(status) = changes.status {
        active.status = Set(status.as_str().to_owned());
    }
    active.updated_at = Set(Utc::now().fixed_offset());
    active.updater = Set(Some(actor.as_uuid()));

    let updated = active.update(conn).await?;
    member_from_model(updated).map(Some)
}

/// 移除成员关系；是否移除了返回布尔。
pub async fn remove_member<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
    user: UserId,
) -> Result<bool, PersistError> {
    let result = tenant_member::Entity::delete_many()
        .filter(tenant_member::Column::TenantId.eq(tenant.as_uuid()))
        .filter(tenant_member::Column::UserId.eq(user.as_uuid()))
        .exec(conn)
        .await?;
    Ok(result.rows_affected > 0)
}

fn member_query(tenant: TenantId, user: UserId) -> sea_orm::Select<tenant_member::Entity> {
    tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.eq(tenant.as_uuid()))
        .filter(tenant_member::Column::UserId.eq(user.as_uuid()))
}

fn tenant_from_model(model: tenant::Model) -> Result<Tenant, PersistError> {
    Ok(Tenant {
        id: TenantId::from_uuid(model.id),
        name: model.name,
        slug: model.slug,
        status: account_status_of(&model.status)?,
        tenant_type: model
            .tenant_type
            .parse::<TenantType>()
            .map_err(|err| unknown("tenant.type", err))?,
        created_at_ms: model.created_at.timestamp_millis(),
        updated_at_ms: model.updated_at.timestamp_millis(),
    })
}

fn member_from_model(model: tenant_member::Model) -> Result<Member, PersistError> {
    Ok(Member {
        row_id: model.id,
        tenant_id: TenantId::from_uuid(model.tenant_id),
        user_id: UserId::from_uuid(model.user_id),
        role: tenant_role_of(&model.role)?,
        status: account_status_of(&model.status)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenant_type_literal_round_trip() {
        for kind in TenantType::all() {
            assert_eq!(kind.as_str().parse::<TenantType>(), Ok(*kind));
        }
        assert_eq!("team".parse::<TenantType>(), Ok(TenantType::Team));
    }

    #[test]
    fn unknown_tenant_type_is_an_error_not_a_default() {
        assert!("ORGANIZATION".parse::<TenantType>().is_err());
        assert!("".parse::<TenantType>().is_err());
    }

    #[test]
    fn only_personal_tenants_use_the_free_quota_ladder() {
        assert!(TenantType::Personal.is_personal());
        assert!(!TenantType::Team.is_personal());
    }
}
