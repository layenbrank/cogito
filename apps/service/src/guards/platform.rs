//! 平台守卫：进入**特权作用域**的唯一入口（`Storage::platform_tx` 只允许在这里调用，门禁 R8 强制）。
//!
//! 默认的租户/账号作用域是 fail-closed 的：看不到别的租户，也写不出全局行。
//! 但运维面确实需要这两件事——平台目录的全局行（`"tenantID" IS NULL`）要能写，
//! 用量与审计要能跨租户汇总。于是保留**一个**显式出口，而不是把策略整体放宽：
//! 提权语句（`SET LOCAL ROLE cogito_platform`）跟着事务走，出事务即失效。
//!
//! 权限判定不在这里：能走到这里的调用点都在 `Auth::admin()` 之后，确权由调用方负责；
//! 本类型只负责「这段代码在特权角色下跑」，与 [`crate::guards::tenant::TenantScope`] 同类。

use sea_orm::DatabaseTransaction;

use crate::databases::database::Storage;

/// 已提权的事务：绕过行级策略，看得到所有租户的行，也写得出全局行。
///
/// 生命周期与一次操作绑定：写操作由调用方显式 [`commit`](Self::commit)，
/// 未提交（含出错返回）即随事务回滚，提权随之失效；
/// **不得把特权事务跨越外部网络调用持有**（模型上游会占住连接与行锁）。
pub struct PlatformScope {
    tx: DatabaseTransaction,
}

impl PlatformScope {
    /// 开启平台特权事务；**调用方必须已经确权**（路由层 `Auth::admin()`）。
    ///
    /// # Errors
    /// 事务无法开启，或应用角色无法提权（角色缺失、未授予成员）时返回底层数据库错误。
    pub async fn open(storage: &Storage) -> Result<Self, sea_orm::DbErr> {
        let tx = storage.platform_tx().await?;

        Ok(Self { tx })
    }

    /// 带特权的事务；全局行与跨租户汇总都从这里出发。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        &self.tx
    }

    /// 提交事务；提权随之结束。
    ///
    /// # Errors
    /// 提交失败时返回底层数据库错误。
    pub async fn commit(self) -> Result<(), sea_orm::DbErr> {
        self.tx.commit().await
    }

    /// 放弃事务：只读路径结束时显式释放连接，不必等 drop 回收。
    ///
    /// # Errors
    /// 回滚失败时返回底层数据库错误。
    pub async fn rollback(self) -> Result<(), sea_orm::DbErr> {
        self.tx.rollback().await
    }
}
