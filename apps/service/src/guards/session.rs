//! 请求身份上下文：验签之后、进入 Handler 之前，把「令牌」变成「身份」。
//!
//! 结论只有一份：账号状态与平台角色都以**库**为准，令牌只证明「是谁」（`sub` + 有效期）。
//! 于是角色调整、账号停用立即生效，不必等令牌过期；库里的字面量无法识别时直接拒绝，
//! 绝不回退到默认角色。
//!
//! 代价是每个已认证请求一次读库（量与既有的黑名单 Redis 查询同级）。将来若成为瓶颈，
//! 可在 Redis 上加会话缓存，判定入口不需要改。

use actix_web::{HttpMessage, HttpRequest};
use identity::{Account, PersistError, PlatformRole, Principal, UserId, persistence};

use crate::databases::database::Storage;
use crate::utils::jwt::Claims;

/// 已确认存在且可用的请求身份。
///
/// 只增不减：Handler 从请求扩展里取它，不再各自解析令牌。
#[derive(Debug, Clone)]
pub struct Session {
    account: Account,
    token: String,
    expires_at: i64,
}

impl Session {
    /// 由已验签的 claims 建立会话：账号必须存在且启用。
    ///
    /// # Errors
    /// 主体不是合法用户标识、账号不存在、账号停用，或账号数据不可读时返回 [`SessionError`]。
    pub async fn resolve(
        storage: &Storage,
        claims: &Claims,
        token: &str,
    ) -> Result<Self, SessionError> {
        let user_id = claims
            .sub
            .parse::<UserId>()
            .map_err(|_| SessionError::InvalidSubject)?;

        let Some(account) = persistence::find_account(storage.raw(), user_id).await? else {
            return Err(SessionError::UnknownAccount);
        };

        if !account.is_active() {
            return Err(SessionError::AccountDisabled);
        }

        Ok(Self {
            account,
            token: token.to_owned(),
            expires_at: claims.exp,
        })
    }

    /// 从请求扩展取会话；未认证请求返回 `None`。
    #[must_use]
    pub fn of(http: &HttpRequest) -> Option<Self> {
        http.extensions().get::<Self>().cloned()
    }

    /// 账号标识。
    #[must_use]
    pub const fn user_id(&self) -> UserId {
        self.account.id()
    }

    /// 当前账号的领域身份（本步不含租户上下文）。
    #[must_use]
    pub const fn principal(&self) -> Principal {
        Principal::new(self.account.id(), self.account.platform_role())
    }

    /// 平台角色。
    #[must_use]
    pub const fn platform_role(&self) -> PlatformRole {
        self.account.platform_role()
    }

    /// 是否为平台管理员。
    #[must_use]
    pub const fn is_platform_admin(&self) -> bool {
        self.account.is_platform_admin()
    }

    /// 原始令牌（登出、加黑名单用）。
    #[must_use]
    pub fn token(&self) -> &str {
        &self.token
    }

    /// 令牌到期时间（Unix 秒）。
    #[must_use]
    pub const fn expires_at(&self) -> i64 {
        self.expires_at
    }
}

/// 会话建立失败的原因。
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// `sub` 不是合法的用户标识。
    #[error("令牌主体不是合法的用户标识")]
    InvalidSubject,
    /// 账号不存在（已删除）。
    #[error("账号不存在")]
    UnknownAccount,
    /// 账号已停用。
    #[error("账号已停用")]
    AccountDisabled,
    /// 账号数据不可读或不可识别。
    #[error(transparent)]
    Persist(#[from] PersistError),
}

/// 会话的构造与错误信息（不依赖数据库）。
#[cfg(test)]
mod tests {
    use super::*;
    use identity::AccountStatus;

    fn admin_account() -> Account {
        let role: PlatformRole = "ADMIN".parse().unwrap();

        Account::new(UserId::generate(), "alice", role, AccountStatus::Active)
    }

    #[test]
    fn unauthenticated_request_has_no_session() {
        let req = actix_web::test::TestRequest::get().to_http_request();

        assert!(Session::of(&req).is_none());
    }

    #[test]
    fn session_reports_the_account_identity() {
        let session = Session {
            account: admin_account(),
            token: "raw-token".to_owned(),
            expires_at: 42,
        };

        assert!(session.is_platform_admin());
        assert_eq!(session.token(), "raw-token");
        assert_eq!(session.expires_at(), 42);
        assert_eq!(session.user_id(), session.principal().user_id());
    }

    #[test]
    fn errors_are_descriptive() {
        assert_eq!(SessionError::AccountDisabled.to_string(), "账号已停用");
        assert_eq!(SessionError::UnknownAccount.to_string(), "账号不存在");
    }
}
