//! SSO 守卫：匿名 OIDC 流程（authorize / callback）接回租户作用域的唯一引导路径
//! （`Storage::sso_connection_tx` 只允许在这里调用，门禁 R7 强制）。
//!
//! IdP 把浏览器跳回来时**没有我们的会话**，所以这条路径不能靠身份，只能把回调地址里的
//! 连接 id 当能力键用。流程因此分两段，中间隔着对 IdP 的若干次外部调用：
//!
//! 1. [`SsoConnectionScope`]：只带连接 id 的事务，读回那一行**未归档**连接
//!    （`sso_connection` 的只读分支），拿到它的 `"tenantID"`；
//! 2. [`SsoLoginScope`]：外部调用（discovery / token / userinfo）都结束之后，
//!    才按上面那个租户开一段短事务，把账号与成员关系写进去。
//!
//! 两段分开是刻意的：IdP 往返可能跑几秒，事务绝不能跨越它（否则连接池会被长事务占满），
//! 而且读到连接行之后再动网络，也避免了「拿着看不到的连接去做外部请求」。
//!
//! 与别的守卫一样，这里只有作用域、**没有权限判定**：连接是否可用（`status`）由领域层判，
//! 守卫只保证「看得到才可能有结论」。

use identity::TenantId;
use sea_orm::{DatabaseTransaction, DbErr};
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::guards::tenant::TenantScope;

/// 第一段：只凭连接 id 读回那一行未归档 SSO 连接。
pub struct SsoConnectionScope {
    tx: DatabaseTransaction,
    connection_id: Uuid,
}

impl SsoConnectionScope {
    /// 按连接 id 进入能力键事务（`"id" = app_current_sso_connection_id() AND "archivedAt" IS NULL`）。
    ///
    /// # Errors
    /// 事务无法开启时返回底层数据库错误（调用方应答 500）。
    pub async fn open(storage: &Storage, connection_id: Uuid) -> Result<Self, DbErr> {
        let tx = storage.sso_connection_tx(connection_id).await?;

        Ok(Self { tx, connection_id })
    }

    /// 带能力键的事务：读连接行走这里，读不到就是「连接不存在」。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        &self.tx
    }

    /// 本次流程用的连接 id。
    #[must_use]
    pub const fn connection_id(&self) -> Uuid {
        self.connection_id
    }

    /// 收尾：只读连接，正常路径一律回滚——**必须在动网络之前调用**，
    /// 别把能力键事务带去等 IdP 响应。
    ///
    /// # Errors
    /// 回滚失败时返回底层数据库错误。
    pub async fn close(self) -> Result<(), DbErr> {
        self.tx.rollback().await
    }
}

/// 第二段：把 OIDC 校验过的登录结果写进连接所属租户。
pub struct SsoLoginScope {
    scope: TenantScope,
}

impl SsoLoginScope {
    /// 按连接行里的租户开一段短事务。
    ///
    /// 租户 id 来自 [`SsoConnectionScope`] 读到的那一行（不是请求参数），因此调用方
    /// **已经确权**：能读到连接就意味着这次登录本来就是为那个租户发起的。
    ///
    /// # Errors
    /// 事务无法开启时返回底层数据库错误。
    pub async fn open(storage: &Storage, tenant_id: TenantId) -> Result<Self, DbErr> {
        Ok(Self {
            scope: TenantScope::open(storage, tenant_id).await?,
        })
    }

    /// 带租户作用域的事务：账号与成员关系都落在这里。
    #[must_use]
    pub fn tx(&self) -> &DatabaseTransaction {
        self.scope.tx()
    }

    /// 提交：账号与成员关系一起落库（只提交一次，避免出现「有账号没成员」的半截状态）。
    ///
    /// # Errors
    /// 提交失败时返回底层数据库错误。
    pub async fn commit(self) -> Result<(), DbErr> {
        self.scope.commit().await
    }

    /// 回滚：本次登录不留下任何痕迹。
    ///
    /// # Errors
    /// 回滚失败时返回底层数据库错误。
    pub async fn rollback(self) -> Result<(), DbErr> {
        self.scope.rollback().await
    }
}
