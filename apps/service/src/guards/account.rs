//! 账号守卫：进入**账号作用域**的唯一入口（`Storage::user_tx` 只允许在这里调用，门禁 R7 强制）。
//!
//! 账号作用域是比租户更小的一层身份：只有「我是谁」，没有「我在哪个租户」。
//! 它能读的只有跨租户但属于**本人**的那部分——我加入的租户、我的成员行、
//! 以及我没有租户时落下的用量与审计；别人的无租户行与所有租户数据照旧读不到也写不进
//! （策略见迁移里的 `tenant_isolation`）。
//!
//! 与 [`crate::guards::tenant::TenantScope`] 同类：只有作用域，**没有权限判定**。
//! 请求路径的身份由鉴权中间件与 [`Session`] 确认，机器路径的确权由调用方负责。
//!
//! - [`AccountScope::enter`]：请求路径。选了租户用
//!   [`TenantCtx`](crate::guards::tenant::TenantCtx)，没选租户（或本来就不属于任何租户）
//!   的操作落在这里。
//! - [`AccountScope::open`]：机器路径。上游调用结束后给**本人**落用量与审计时用——
//!   那一刻请求作用域已经结束，身份是从请求里带过来的既有事实。

use identity::UserId;
use sea_orm::DatabaseTransaction;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::utils::code::external;

/// 已进入账号作用域的事务。
///
/// 生命周期与一次操作绑定：写操作由调用方显式 [`commit`](Self::commit)，
/// 未提交（含出错返回）即随事务回滚，作用域变量随之失效；
/// **不得把作用域跨越外部网络调用持有**（模型上游会占住连接）。
pub struct AccountScope {
    tx: DatabaseTransaction,
    user_id: UserId,
}

impl AccountScope {
    /// 进入当前会话的账号作用域（请求路径）。
    ///
    /// # Errors
    /// 事务无法开启时返回 500（`external::DATABASE_ERROR`）。
    pub async fn enter(storage: &Storage, session: &Session) -> Result<Self, Exception> {
        Self::open(storage, session.user_id())
            .await
            .map_err(db_error)
    }

    /// 打开指定账号的作用域事务（机器路径）；**调用方必须已经确权**。
    ///
    /// # Errors
    /// 事务无法开启时返回底层数据库错误。
    pub async fn open(storage: &Storage, user_id: UserId) -> Result<Self, sea_orm::DbErr> {
        let tx = storage.user_tx(user_id).await?;

        Ok(Self { tx, user_id })
    }

    /// 带作用域的事务；本人可见的跨租户只读与本人无租户行的写入都从这里出发。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        &self.tx
    }

    /// 当前账号。
    #[must_use]
    pub const fn user_id(&self) -> UserId {
        self.user_id
    }

    /// 提交事务；作用域随之结束。
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

/// 数据库错误：日志留因，响应只给码。
fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "account scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
