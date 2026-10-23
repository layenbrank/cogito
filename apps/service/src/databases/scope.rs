//! 请求作用域：把「我在哪个租户 / 我是谁」写进当前事务，RLS 据此过滤行。
//!
//! 作用域是**事务局部**的（`set_config(..., true)`），提交或回滚后自动失效，
//! 因此不会残留在池化连接上串到下一个请求。作用域由守卫在进入业务逻辑前建立，
//! 业务代码只拿到已经带作用域的事务，不再自己拼 `tenantID = ?` 条件。

use identity::{TenantId, UserId};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseTransaction, DbErr, Statement, TransactionTrait,
};
use uuid::Uuid;

use super::database::Storage;

/// 会话级租户作用域变量：RLS 策略经 `app_current_tenant_id()` 读取它。
pub const TENANT_SETTING: &str = "app.tenant_id";

/// 会话级账号作用域变量：RLS 策略经 `app_current_user_id()` 读取它，
/// 用于「跨租户、只读自己」的场景（例如列出我加入的租户、读我自己的成员行）。
pub const USER_SETTING: &str = "app.user_id";

/// 会话级能力键变量：支付回调没有会话，只有渠道回传的订单号，
/// `payment_order` 的只读分支据此把那一行订单借给回调代码（见迁移里的策略）。
pub const ORDER_SETTING: &str = "app.order_no";

/// 会话级能力键变量：内容寻址（秒传）的文件 hash。
///
/// `asset` 的只读分支据此把那一行**已完成**资产借给上传代码——同一份字节被多个账号
/// 各自持有一行，秒传必须先看到内容才知道要克隆什么。
pub const ASSET_HASH_SETTING: &str = "app.asset_hash";

/// 会话级能力键变量：SSO 连接 id。
///
/// OIDC 的 authorize / callback 是匿名端点（浏览器从第三方 IdP 跳回来时没有我们的会话），
/// `sso_connection` 的只读分支据此把那一行**未归档**连接借给流程代码。
pub const SSO_CONNECTION_SETTING: &str = "app.sso_connection_id";

/// 平台运维角色：**唯一**一条绕过行级策略的通道（迁移里创建，`NOLOGIN`，只能由应用角色 `SET ROLE` 进入）。
///
/// 只给运维面用：平台目录的全局行（`"tenantID" IS NULL`）与跨租户汇总，租户面永远不需要它。
pub const PLATFORM_ROLE: &str = "cogito_platform";

/// 在当前连接/事务上设定作用域变量。
///
/// 值以参数传入而非拼接 SQL；值非法时对应的 `app_current_*()` 返回 NULL，
/// 受保护的表全部读不到行、写入被拒（fail-closed）。
async fn set_scope<C>(conn: &C, key: &str, value: &str) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    conn.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "SELECT set_config($1, $2, true)",
        [key.into(), value.into()],
    ))
    .await?;
    Ok(())
}

/// 在当前连接/事务上设定租户作用域。
pub async fn apply_tenant_scope<C>(conn: &C, tenant_id: TenantId) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    set_scope(conn, TENANT_SETTING, &tenant_id.to_string()).await
}

/// 在当前连接/事务上设定账号作用域。
pub async fn apply_user_scope<C>(conn: &C, user_id: UserId) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    set_scope(conn, USER_SETTING, &user_id.to_string()).await
}

/// 在当前连接/事务上设定支付能力键（订单号）。
///
/// 它**不等于**租户作用域：只让 `payment_order` 里那一行未归档订单可读，
/// 写入仍被 `WITH CHECK` 挡住，所以只能在引导阶段短暂存在，拿到 `tenantID`
/// 后必须立刻 [`apply_tenant_scope`]。
pub async fn apply_order_capability<C>(conn: &C, order_no: &str) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    set_scope(conn, ORDER_SETTING, order_no).await
}

/// 在当前连接/事务上设定内容寻址能力键（文件 hash）。
///
/// 与订单号同理：**不等于**作用域。它只让 `asset` 里 hash 命中且已完成的那一行可读，
/// 写入仍被 `WITH CHECK` 挡住，所以只能短暂存在，读到内容后立刻释放。
pub async fn apply_asset_capability<C>(conn: &C, hash: &str) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    set_scope(conn, ASSET_HASH_SETTING, hash).await
}

/// 在当前连接/事务上设定 SSO 连接能力键（连接 id）。
///
/// 同样是**能力键而不是作用域**：只让 `sso_connection` 里那一行未归档连接可读。
/// 匿名 OIDC 流程没有别的身份可用（IdP 跳回来时没有我们的会话），因此它是那条路径上
/// 「读回连接」的唯一办法；读到 `"tenantID"` 之后必须立刻换成真正的租户作用域。
pub async fn apply_sso_capability<C>(conn: &C, connection_id: Uuid) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    set_scope(conn, SSO_CONNECTION_SETTING, &connection_id.to_string()).await
}

/// 在当前事务上提权到平台运维角色。
///
/// 与作用域变量同样的性质：**事务局部**（`SET LOCAL ROLE`），提交或回滚后当前角色自动
/// 退回应用角色，不会残留在池化连接上串到下一个请求。角色名是编译期常量
/// （标识符无法参数化），不含任何外部输入。
async fn apply_platform_role<C>(conn: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    conn.execute_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        format!("SET LOCAL ROLE {PLATFORM_ROLE}"),
    ))
    .await
    .map_err(|err| {
        DbErr::Custom(format!(
            "平台通道不可用（SET LOCAL ROLE {PLATFORM_ROLE} 失败）：{err}；\
             数据库需要先创建该角色并把应用角色加为成员（见 guide/database.md）"
        ))
    })?;
    Ok(())
}

impl Storage {
    /// 开启只带支付能力键的事务：唯一用途是回调引导阶段「订单号 → 租户」的反解，
    /// 反解成功后由守卫在同一事务上补租户作用域（见 `guards::payment`）。
    pub async fn order_tx(&self, order_no: &str) -> Result<DatabaseTransaction, DbErr> {
        let tx = self.raw().begin().await?;
        apply_order_capability(&tx, order_no).await?;
        Ok(tx)
    }

    /// 开启受租户作用域约束的事务。租户内的读写走这个入口。
    pub async fn tenant_tx(&self, tenant_id: TenantId) -> Result<DatabaseTransaction, DbErr> {
        let tx = self.raw().begin().await?;
        apply_tenant_scope(&tx, tenant_id).await?;
        Ok(tx)
    }

    /// 开启只受账号作用域约束的事务：可读自己所属的租户与自己的成员行，
    /// 但没有租户作用域，写不进任何租户数据。
    pub async fn user_tx(&self, user_id: UserId) -> Result<DatabaseTransaction, DbErr> {
        let tx = self.raw().begin().await?;
        apply_user_scope(&tx, user_id).await?;
        Ok(tx)
    }

    /// 开启只带内容寻址能力键的事务：`asset` 里 hash 命中且已完成的那一行可读，
    /// 用来找秒传源（见 `guards::asset::AssetContentScope`）。
    pub async fn asset_hash_tx(&self, hash: &str) -> Result<DatabaseTransaction, DbErr> {
        let tx = self.raw().begin().await?;
        apply_asset_capability(&tx, hash).await?;
        Ok(tx)
    }

    /// 开启只带 SSO 连接能力键的事务：`sso_connection` 里那一行未归档连接可读，
    /// 用来把匿名 OIDC 流程接回它所属的租户（见 `guards::sso::SsoConnectionScope`）。
    pub async fn sso_connection_tx(
        &self,
        connection_id: Uuid,
    ) -> Result<DatabaseTransaction, DbErr> {
        let tx = self.raw().begin().await?;
        apply_sso_capability(&tx, connection_id).await?;
        Ok(tx)
    }

    /// 开启**无作用域**事务：什么都读不到，除了策略里对匿名开放的那部分
    /// （目前只有 `PUBLIC` 资产）。
    ///
    /// **不要直接调用**：入口是 [`crate::guards::asset::AssetReader`] 的匿名分支，
    /// 调用点被门禁限制在白名单文件内（见 `scripts/capabilities.ts`）。
    pub async fn anon_tx(&self) -> Result<DatabaseTransaction, DbErr> {
        self.raw().begin().await
    }

    /// 开启平台运维事务：在行级策略之上提权到 [`PLATFORM_ROLE`]，用于平台目录的全局行
    /// 与跨租户汇总读。
    ///
    /// **不要直接调用**：入口是 [`crate::guards::platform::PlatformScope`]，
    /// 调用点被门禁限制在白名单文件内（见 `scripts/capabilities.ts`）。
    pub async fn platform_tx(&self) -> Result<DatabaseTransaction, DbErr> {
        let tx = self.raw().begin().await?;
        apply_platform_role(&tx).await?;
        Ok(tx)
    }
}
