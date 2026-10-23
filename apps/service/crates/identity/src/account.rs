//! 账号与账号状态（`auth` 表的领域视图）。
//!
//! 这里只回答「账号是什么」；HTTP 契约里的角色枚举属于 `cogito` 的 wire 层，
//! 二者刻意分开：契约可以演化，身份判定不随之漂移。

use std::{fmt, str::FromStr};

use crate::{PlatformRole, UnknownRole, UserId, parse_literal};

/// 账号状态（`auth.status`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[non_exhaustive]
pub enum AccountStatus {
    /// 正常：可以建立会话。
    Active,
    /// 停用：不建立会话，已签发的令牌按失效处理。
    Disabled,
}

impl AccountStatus {
    /// 数据库存储字面量。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Disabled => "DISABLED",
        }
    }

    /// 全部状态，用于解析与遍历。
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[Self::Active, Self::Disabled]
    }

    /// 是否允许继续使用系统。
    #[must_use]
    pub const fn is_active(self) -> bool {
        matches!(self, Self::Active)
    }
}

impl FromStr for AccountStatus {
    type Err = UnknownRole;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        parse_literal(value, Self::all().iter().map(|s| (s.as_str(), *s)))
    }
}

impl fmt::Display for AccountStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 账号：全局身份，不随租户变化。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    id: UserId,
    username: String,
    platform_role: PlatformRole,
    status: AccountStatus,
}

impl Account {
    /// 以已解析的字段构造。
    #[must_use]
    pub fn new(
        id: UserId,
        username: impl Into<String>,
        platform_role: PlatformRole,
        status: AccountStatus,
    ) -> Self {
        Self {
            id,
            username: username.into(),
            platform_role,
            status,
        }
    }

    /// 账号标识。
    #[must_use]
    pub const fn id(&self) -> UserId {
        self.id
    }

    /// 登录名。
    #[must_use]
    pub fn username(&self) -> &str {
        &self.username
    }

    /// 平台角色。
    #[must_use]
    pub const fn platform_role(&self) -> PlatformRole {
        self.platform_role
    }

    /// 账号状态。
    #[must_use]
    pub const fn status(&self) -> AccountStatus {
        self.status
    }

    /// 是否可建立/继续会话。
    #[must_use]
    pub const fn is_active(&self) -> bool {
        self.status.is_active()
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
    fn status_literal_round_trip() {
        for status in AccountStatus::all() {
            assert_eq!(status.as_str().parse::<AccountStatus>(), Ok(*status));
        }
    }

    #[test]
    fn unknown_status_is_an_error_not_a_default() {
        assert!("SUSPENDED".parse::<AccountStatus>().is_err());
        assert!("".parse::<AccountStatus>().is_err());
    }

    #[test]
    fn account_exposes_state() {
        let account = Account::new(
            UserId::generate(),
            "alice",
            PlatformRole::Admin,
            AccountStatus::Disabled,
        );

        assert_eq!(account.username(), "alice");
        assert!(!account.is_active());
        assert!(account.is_platform_admin());
    }

    #[test]
    fn platform_user_is_not_admin() {
        let account = Account::new(
            UserId::generate(),
            "bob",
            PlatformRole::User,
            AccountStatus::Active,
        );

        assert!(account.is_active());
        assert!(!account.is_platform_admin());
    }
}
