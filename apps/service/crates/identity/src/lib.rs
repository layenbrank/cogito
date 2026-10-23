//! 身份能力内核：账号、租户、租户成员关系（数据所有权见 README.md）。
//!
//! 本 crate 不依赖任何 HTTP 框架：调用方（`cogito`）负责把请求上下文解析成 [`Principal`]，
//! 「能不能做」由 `authz` 决策；这里只回答「身份是什么」。

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod account;
pub mod persistence;
pub mod tenant;

pub use account::{Account, AccountStatus};
pub use persistence::PersistError;

/// 租户标识。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TenantId(Uuid);

impl TenantId {
    /// 以现有 UUID 构造。
    #[must_use]
    pub const fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    /// 生成新租户标识。
    #[must_use]
    pub fn generate() -> Self {
        Self(Uuid::new_v4())
    }

    /// 取出内部 UUID。
    #[must_use]
    pub const fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for TenantId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl FromStr for TenantId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value.trim()).map(Self)
    }
}

/// 账号标识（全局唯一，不随租户变化）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserId(Uuid);

impl UserId {
    /// 以现有 UUID 构造。
    #[must_use]
    pub const fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    /// 生成新账号标识。
    #[must_use]
    pub fn generate() -> Self {
        Self(Uuid::new_v4())
    }

    /// 取出内部 UUID。
    #[must_use]
    pub const fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for UserId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl FromStr for UserId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value.trim()).map(Self)
    }
}

/// 角色字面量的解析失败（未知或为空）。
///
/// 解析刻意返回错误而不是回退到默认角色：数据库里的角色字面量一旦无法识别，
/// 必须由调用方显式处理（通常按「无权限」处理），不允许静默降级或静默提权。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown role: {0:?}")]
pub struct UnknownRole(String);

impl UnknownRole {
    /// 原始字面量。
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// 解析大写存储的字面量（角色、状态等）；大小写不敏感，前后空白忽略。
fn parse_literal<'a, T, I>(value: &str, table: I) -> Result<T, UnknownRole>
where
    I: IntoIterator<Item = (&'a str, T)>,
{
    let value = value.trim();
    table
        .into_iter()
        .find(|(literal, _)| literal.eq_ignore_ascii_case(value))
        .map(|(_, role)| role)
        .ok_or_else(|| UnknownRole(value.to_owned()))
}

/// 平台级角色（`auth.role`），决定跨租户的运营权限。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[non_exhaustive]
pub enum PlatformRole {
    /// 普通用户：只能通过租户成员身份获得权限。
    User,
    /// 平台管理员：运维、排障、跨租户只读等平台侧权限。
    Admin,
}

impl PlatformRole {
    /// 数据库存储字面量。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "USER",
            Self::Admin => "ADMIN",
        }
    }

    /// 全部角色，用于策略表遍历与测试。
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[Self::User, Self::Admin]
    }

    /// 是否为平台管理员。
    #[must_use]
    pub const fn is_platform_admin(self) -> bool {
        matches!(self, Self::Admin)
    }
}

impl FromStr for PlatformRole {
    type Err = UnknownRole;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        parse_literal(value, Self::all().iter().map(|role| (role.as_str(), *role)))
    }
}

impl fmt::Display for PlatformRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 租户内角色（`tenant_member.role`），决定该租户内的业务权限。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[non_exhaustive]
pub enum TenantRole {
    /// 所有者：租户的最高权限，含租户本身的管理与计费。
    Owner,
    /// 管理员：日常管理成员与配置，但不能处置租户本身与计费主体。
    Admin,
    /// 成员：日常业务读写。
    Member,
}

impl TenantRole {
    /// 数据库存储字面量。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "OWNER",
            Self::Admin => "ADMIN",
            Self::Member => "MEMBER",
        }
    }

    /// 全部角色，按权限从高到低排列。
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[Self::Owner, Self::Admin, Self::Member]
    }
}

impl FromStr for TenantRole {
    type Err = UnknownRole;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        parse_literal(value, Self::all().iter().map(|role| (role.as_str(), *role)))
    }
}

impl fmt::Display for TenantRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 一次请求的身份上下文：账号 + 平台角色 + 当前租户与租户内角色。
///
/// 由调用方在认证阶段构造，之后只读传递；`tenant()` 为 `None` 表示「未进入任何租户
/// 上下文」，此时租户内权限一律拒绝。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    user_id: UserId,
    platform_role: PlatformRole,
    tenant: Option<TenantContext>,
}

/// 当前租户上下文：作用域与租户内角色解耦。
///
/// `role` 为 `None` 表示「已进入租户作用域但没有成员身份」，只有平台角色持有者会走到
/// 这个状态（运维通道）；权限判定由 `authz` 依据平台角色另行放行。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TenantContext {
    tenant_id: TenantId,
    role: Option<TenantRole>,
}

impl TenantContext {
    /// 仅作用域，无成员身份（平台运维通道）。
    #[must_use]
    pub const fn new(tenant_id: TenantId) -> Self {
        Self {
            tenant_id,
            role: None,
        }
    }

    /// 带租户内成员角色的上下文。
    #[must_use]
    pub const fn member(tenant_id: TenantId, role: TenantRole) -> Self {
        Self {
            tenant_id,
            role: Some(role),
        }
    }

    /// 租户创建者的上下文：新建租户时调用者即为它的 Owner。
    #[must_use]
    pub const fn owner(tenant_id: TenantId) -> Self {
        Self::member(tenant_id, TenantRole::Owner)
    }

    /// 租户标识。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.tenant_id
    }

    /// 租户内角色（无成员身份时为 `None`）。
    #[must_use]
    pub const fn role(&self) -> Option<TenantRole> {
        self.role
    }

    /// 是否持有该租户的成员身份。
    #[must_use]
    pub const fn is_member(&self) -> bool {
        self.role.is_some()
    }
}

impl Principal {
    /// 未进入租户上下文的账号。
    #[must_use]
    pub const fn new(user_id: UserId, platform_role: PlatformRole) -> Self {
        Self {
            user_id,
            platform_role,
            tenant: None,
        }
    }

    /// 追加当前租户上下文。
    #[must_use]
    pub const fn with_tenant(mut self, tenant: TenantContext) -> Self {
        self.tenant = Some(tenant);
        self
    }

    /// 账号标识。
    #[must_use]
    pub const fn user_id(&self) -> UserId {
        self.user_id
    }

    /// 平台角色。
    #[must_use]
    pub const fn platform_role(&self) -> PlatformRole {
        self.platform_role
    }

    /// 当前租户（未选择租户时为 `None`）。
    #[must_use]
    pub const fn tenant(&self) -> Option<TenantContext> {
        self.tenant
    }

    /// 当前租户标识。
    #[must_use]
    pub const fn tenant_id(&self) -> Option<TenantId> {
        match self.tenant {
            Some(context) => Some(context.tenant_id),
            None => None,
        }
    }

    /// 当前租户内的角色（进入作用域但无成员身份时为 `None`）。
    #[must_use]
    pub const fn tenant_role(&self) -> Option<TenantRole> {
        match self.tenant {
            Some(context) => context.role,
            None => None,
        }
    }

    /// 是否为平台管理员。
    #[must_use]
    pub const fn is_platform_admin(&self) -> bool {
        matches!(self.platform_role, PlatformRole::Admin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenant_role_literal_round_trip() {
        for role in TenantRole::all() {
            assert_eq!(role.as_str().parse::<TenantRole>(), Ok(*role));
        }
        for role in PlatformRole::all() {
            assert_eq!(role.as_str().parse::<PlatformRole>(), Ok(*role));
        }
    }

    #[test]
    fn role_parse_is_case_insensitive_and_trims() {
        assert_eq!("owner".parse::<TenantRole>(), Ok(TenantRole::Owner));
        assert_eq!("  member ".parse::<TenantRole>(), Ok(TenantRole::Member));
        assert_eq!("admin".parse::<PlatformRole>(), Ok(PlatformRole::Admin));
    }

    #[test]
    fn unknown_role_is_an_error_not_a_default() {
        let err = "superuser".parse::<TenantRole>().unwrap_err();
        assert_eq!(err.as_str(), "superuser");
        assert!("".parse::<PlatformRole>().is_err());
    }

    #[test]
    fn principal_without_tenant_has_no_tenant_context() {
        let principal = Principal::new(UserId::generate(), PlatformRole::User);
        assert_eq!(principal.tenant_id(), None);
        assert_eq!(principal.tenant_role(), None);
        assert!(!principal.is_platform_admin());
    }

    #[test]
    fn principal_carries_tenant_membership() {
        let tenant_id = TenantId::generate();
        let principal = Principal::new(UserId::generate(), PlatformRole::User)
            .with_tenant(TenantContext::member(tenant_id, TenantRole::Owner));

        assert_eq!(principal.tenant_id(), Some(tenant_id));
        assert_eq!(principal.tenant_role(), Some(TenantRole::Owner));
        assert!(
            principal
                .tenant()
                .is_some_and(|context| context.is_member())
        );
    }

    #[test]
    fn tenant_context_without_membership_has_no_role() {
        let tenant_id = TenantId::generate();
        let principal = Principal::new(UserId::generate(), PlatformRole::Admin)
            .with_tenant(TenantContext::new(tenant_id));

        assert_eq!(principal.tenant_id(), Some(tenant_id));
        assert_eq!(principal.tenant_role(), None);
        assert!(!principal.tenant().unwrap().is_member());
        assert!(principal.is_platform_admin());
    }

    #[test]
    fn ids_parse_from_string_and_serialize_transparently() {
        let tenant_id = TenantId::generate();
        let parsed = tenant_id.to_string().parse::<TenantId>().unwrap();
        assert_eq!(parsed, tenant_id);

        let json = serde_json::to_string(&tenant_id).unwrap();
        assert_eq!(json, format!("\"{tenant_id}\""));
        assert_eq!(serde_json::from_str::<TenantId>(&json).unwrap(), tenant_id);
    }
}
