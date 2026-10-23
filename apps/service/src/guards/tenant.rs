//! 租户守卫：进入租户作用域的**唯一**入口（`Storage::tenant_tx` 只允许在这里调用，门禁 R7 强制）。
//!
//! 顺序是刻意的：先开事务、把租户写进作用域（`app.tenant_id`），再在作用域内读成员关系。
//! 于是「不是成员」查不到任何行，而不是先信任一个未授权租户里的角色字面量；
//! 之后业务代码只拿到带作用域的事务与已确定的身份（[`Principal`]），
//! 既不再自己拼 `tenantID = ?`，也不再自己比较角色。
//!
//! 两个层次，按「有没有请求身份」区分：
//! - [`TenantCtx`]：请求路径。作用域 + 身份 + 权限判定（`authz`）。
//! - [`TenantScope`]：机器路径与内部可信链路（网关 API Key、支付回调、定时任务）。
//!   只有作用域，没有身份，因此**没有权限判定**——确权由调用方负责。
//!
//! 权限判定一律交给 `authz`：守卫只负责「把身份准备好」和「把拒绝翻译成 HTTP」。

use authz::{Permission, require as require_permission};
use identity::{Principal, TenantContext, TenantId};
use sea_orm::DatabaseTransaction;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::utils::code::{auth, external};

/// 已进入租户作用域的事务：只有「哪一段代码在哪个租户里跑」，没有请求身份。
///
/// 给**机器路径与内部可信链路**用：网关的 API Key 调用、支付渠道回调、定时任务都没有会话，
/// 但仍然必须满足「这段代码只看得到这个租户的行」。调用方负责确权（验签、校验 API Key），
/// 本类型只负责把作用域写进事务——所以它不提供任何权限判定。
///
/// 生命周期与一次操作绑定：写操作由调用方显式 [`commit`](Self::commit)，
/// 未提交（含出错返回）即随事务回滚，作用域变量也随之失效；
/// **不得把作用域跨越外部网络调用持有**（支付渠道、模型上游），否则长事务会拖垮连接池。
pub struct TenantScope {
    tx: DatabaseTransaction,
    tenant_id: TenantId,
}

impl TenantScope {
    /// 打开一个租户作用域事务；**调用方必须已经确权**（会话成员判定、API Key 归属、回调验签）。
    ///
    /// 请求路径不要用它，用 [`TenantCtx::enter`]——那里才有成员关系与权限判定。
    ///
    /// # Errors
    /// 事务无法开启时返回底层数据库错误。
    pub async fn open(storage: &Storage, tenant_id: TenantId) -> Result<Self, sea_orm::DbErr> {
        let tx = storage.tenant_tx(tenant_id).await?;

        Ok(Self { tx, tenant_id })
    }

    /// 接续一个**已经写好租户作用域**的事务（能力键引导路径的第二步）。
    ///
    /// 只给 [`crate::guards::payment`] 用：支付回调先按订单号反解租户、写下 `app.tenant_id`，
    /// 再把同一个事务交给统一的句柄类型，之后领域函数与请求路径共用同一套作用域语义。
    /// 本函数**不做任何确权或校验**，调用方必须自己保证作用域已经写好。
    pub(crate) const fn adopt(tx: DatabaseTransaction, tenant_id: TenantId) -> Self {
        Self { tx, tenant_id }
    }

    /// 带作用域的事务；租户内的读写都从这里出发。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        &self.tx
    }

    /// 当前租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.tenant_id
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

/// 已进入租户作用域的一次请求：作用域 + 请求身份。
///
/// 生命周期与请求绑定：写操作由调用方显式 [`commit`](Self::commit)，
/// 未提交（含出错返回）即随事务回滚，作用域变量也随之失效。
pub struct TenantCtx {
    scope: TenantScope,
    principal: Principal,
}

impl TenantCtx {
    /// 进入既有租户：成员关系在作用域内读取，非成员一律拒绝。
    ///
    /// 平台管理员可以不持有成员身份（运维通道）：此时上下文里没有租户角色，
    /// `authz` 依平台角色放行，越过成员关系的那一步必须在业务侧留审计。
    ///
    /// # Errors
    /// 事务无法开启（500）、非成员且非平台管理员（403）。
    pub async fn enter(
        storage: &Storage,
        session: &Session,
        tenant_id: TenantId,
    ) -> Result<Self, Exception> {
        let scope = TenantScope::open(storage, tenant_id)
            .await
            .map_err(db_error)?;

        let membership =
            identity::persistence::membership(scope.tx(), tenant_id, session.user_id())
                .await
                .map_err(persist_error)?;

        if membership.is_none() && !session.is_platform_admin() {
            return Err(Exception::custom(auth::ACCESS_DENIED, "非租户成员"));
        }

        let context = membership.unwrap_or_else(|| TenantContext::new(tenant_id));
        Ok(Self {
            scope,
            principal: session.principal().with_tenant(context),
        })
    }

    /// 创建新租户：作用域指向尚未落库的租户，调用者即为它的 Owner。
    ///
    /// 建租户是账号级能力（任何已认证账号都可以有租户），因此这里不做权限判定；
    /// 租户与首条成员关系都由 `tenant` 表的策略自约束在新建的作用域内。
    ///
    /// # Errors
    /// 事务无法开启（500）。
    pub async fn open_new(
        storage: &Storage,
        session: &Session,
        tenant_id: TenantId,
    ) -> Result<Self, Exception> {
        let scope = TenantScope::open(storage, tenant_id)
            .await
            .map_err(db_error)?;

        Ok(Self {
            scope,
            principal: session
                .principal()
                .with_tenant(TenantContext::owner(tenant_id)),
        })
    }

    /// 租户作用域本身（需要把它交给只认作用域的领域函数时用）。
    #[must_use]
    pub const fn scope(&self) -> &TenantScope {
        &self.scope
    }

    /// 带作用域的事务；租户内的读写都从这里出发。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        self.scope.tx()
    }

    /// 请求身份（含租户上下文）。
    #[must_use]
    pub const fn principal(&self) -> &Principal {
        &self.principal
    }

    /// 当前租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.scope.tenant_id()
    }

    /// 校验权限；不通过即 403。
    ///
    /// # Errors
    /// `authz` 判定拒绝时返回 403（`auth::INSUFFICIENT_PERMISSIONS`）。
    pub fn require(&self, permission: Permission) -> Result<(), Exception> {
        require_permission(&self.principal, permission).map_err(|denied| {
            tracing::debug!(
                permission = %denied.permission,
                reason = %denied.reason,
                "租户权限不足"
            );
            Exception::custom(auth::INSUFFICIENT_PERMISSIONS, "权限不足")
        })
    }

    /// 结束当前事务并在**同一租户上立刻开启新事务**（前一段的写入就此提交）。
    ///
    /// 用途只有一个：把「一段数据库工作 → 外部网络调用 → 再一段数据库工作」切成两段短事务。
    /// [`TenantScope`] 约定作用域不得跨越外部调用持有（支付渠道、模型上游会占住连接与行锁），
    /// 于是外部调用前先落定前一段、调用后再开一段。身份与权限在 [`enter`](Self::enter)
    /// 时已经确定，换事务不改变判定结果。
    ///
    /// # Errors
    /// 提交或开启新事务失败返回 500（`external::DATABASE_ERROR`）；此时本段作用域已不可用，
    /// 调用方直接返回错误结束请求即可。
    pub async fn renew(&mut self, storage: &Storage) -> Result<(), Exception> {
        let fresh = TenantScope::open(storage, self.scope.tenant_id())
            .await
            .map_err(db_error)?;
        let previous = std::mem::replace(&mut self.scope, fresh);

        previous.commit().await.map_err(db_error)
    }

    /// 提交事务；作用域随之结束。
    ///
    /// # Errors
    /// 提交失败返回 500（`external::DATABASE_ERROR`）。
    pub async fn commit(self) -> Result<(), Exception> {
        self.scope.commit().await.map_err(db_error)
    }

    /// 放弃事务：只读请求结束时显式释放连接（回滚是空操作，但连接当场归还）。
    ///
    /// # Errors
    /// 回滚失败返回 500（`external::DATABASE_ERROR`）。
    pub async fn rollback(self) -> Result<(), Exception> {
        self.scope.rollback().await.map_err(db_error)
    }
}

/// 数据库错误：日志留因，响应只给码。
fn db_error(err: sea_orm::DbErr) -> Exception {
    tracing::error!(error = %err, "tenant scope transaction failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}

/// 身份数据不可读或不可识别：一律 500，不回退到「当成成员」。
fn persist_error(err: identity::PersistError) -> Exception {
    tracing::error!(error = %err, "tenant scope identity lookup failed");
    Exception::custom(external::DATABASE_ERROR, "数据库错误")
}
