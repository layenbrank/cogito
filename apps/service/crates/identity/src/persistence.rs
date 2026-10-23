//! 身份持久化：账号与租户成员关系。
//!
//! 只做「读事实」：解析失败一律报错（[`PersistError::UnknownLiteral`]），不回退到默认角色，
//! 也不在这里做权限判断（那是 `authz` 的事）。

use entity::{auth, tenant_member};
use sea_orm::{ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter};

use crate::{
    Account, AccountStatus, PlatformRole, TenantContext, TenantId, TenantRole, UnknownRole, UserId,
};

/// 身份读写的失败原因。
#[derive(Debug, thiserror::Error)]
pub enum PersistError {
    /// 数据库访问失败。
    #[error("数据库访问失败：{0}")]
    Db(#[from] DbErr),
    /// 库里的字面量无法识别：拒绝，不降级。`column` 形如 `auth.role`。
    #[error("`{column}` 中的字面量无法识别：{literal}")]
    UnknownLiteral {
        /// 出错列（`表.列`）。
        column: &'static str,
        /// 原始字面量。
        literal: String,
    },
}

/// 按账号标识读取账号；账号不存在返回 `None`。
///
/// `auth` 表不受 RLS 约束（账号是全局身份），因此调用方无需租户作用域。
pub async fn find_account<C: ConnectionTrait>(
    conn: &C,
    id: UserId,
) -> Result<Option<Account>, PersistError> {
    let model = auth::Entity::find_by_id(id.as_uuid()).one(conn).await?;
    model.map(account_from_model).transpose()
}

/// 读取账号在指定租户内的**有效**成员关系（`tenant_member.status = ACTIVE`）。
///
/// 必须在已进入该租户作用域的连接/事务上调用：`tenant_member` 已启用 RLS，
/// 未进入作用域时策略会隐藏行，于是这里查不到而返回 `None`（即「不是成员」）。
/// 「先有作用域、再判成员」的顺序是有意的：不允许用未授权租户的上下文判断身份。
pub async fn membership<C: ConnectionTrait>(
    conn: &C,
    tenant: TenantId,
    user: UserId,
) -> Result<Option<TenantContext>, PersistError> {
    let model = tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.eq(tenant.as_uuid()))
        .filter(tenant_member::Column::UserId.eq(user.as_uuid()))
        .filter(tenant_member::Column::Status.eq(AccountStatus::Active.as_str()))
        .one(conn)
        .await?;

    model.map(membership_from_model).transpose()
}

fn account_from_model(model: auth::Model) -> Result<Account, PersistError> {
    Ok(Account::new(
        UserId::from_uuid(model.id),
        model.username,
        platform_role_of(&model.role)?,
        account_status_of(&model.status)?,
    ))
}

fn membership_from_model(model: tenant_member::Model) -> Result<TenantContext, PersistError> {
    Ok(TenantContext::member(
        TenantId::from_uuid(model.tenant_id),
        tenant_role_of(&model.role)?,
    ))
}

/// `auth.role` → 平台角色。
fn platform_role_of(literal: &str) -> Result<PlatformRole, PersistError> {
    literal
        .parse::<PlatformRole>()
        .map_err(|err| unknown("auth.role", err))
}

/// `auth.status` / `tenant.status` / `tenant_member.status` → 状态。
pub(crate) fn account_status_of(literal: &str) -> Result<AccountStatus, PersistError> {
    literal
        .parse::<AccountStatus>()
        .map_err(|err| unknown("auth.status", err))
}

/// `tenant_member.role` → 租户内角色。
pub(crate) fn tenant_role_of(literal: &str) -> Result<TenantRole, PersistError> {
    literal
        .parse::<TenantRole>()
        .map_err(|err| unknown("tenant_member.role", err))
}

/// 把解析失败包装成带列名的持久化错误。
pub(crate) fn unknown(column: &'static str, err: UnknownRole) -> PersistError {
    PersistError::UnknownLiteral {
        column,
        literal: err.as_str().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_columns_parse_to_domain_roles() {
        assert_eq!(platform_role_of("ADMIN").unwrap(), PlatformRole::Admin);
        assert_eq!(platform_role_of("user").unwrap(), PlatformRole::User);
        assert_eq!(tenant_role_of("OWNER").unwrap(), TenantRole::Owner);
        assert_eq!(account_status_of("ACTIVE").unwrap(), AccountStatus::Active);
    }

    #[test]
    fn unknown_literals_are_rejected_with_their_column() {
        let err = platform_role_of("SUPERUSER").unwrap_err();
        assert_eq!(err.to_string(), "`auth.role` 中的字面量无法识别：SUPERUSER");

        let err = tenant_role_of("").unwrap_err();
        assert!(err.to_string().contains("tenant_member.role"));

        assert!(account_status_of("ENABLED").is_err());
    }
}
