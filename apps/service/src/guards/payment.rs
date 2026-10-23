//! 支付回调守卫：匿名渠道回调进入租户作用域的**唯一**引导路径。
//!
//! 回调没有会话，只有一个由渠道回传、等价于一次性凭证的订单号（能力键）。顺序是刻意的：
//! 先在只认订单号的事务里读回 `"tenantID"`（RLS 的能力键分支只放行那一行未归档订单），
//! **同一个事务**随即补上 `app.tenant_id` 升格为完整的租户作用域。两者之间不存在
//! 「已经知道租户、但作用域还没设」的窗口，后续查询不会掉进无作用域的空读。
//!
//! 反解不到（订单号不存在 / 已归档）时返回 `Ok(None)`：这是**业务**结论，
//! 由支付域决定怎么应答渠道（回「订单不存在」而不是 500，否则渠道会一直重试）。

use identity::TenantId;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseTransaction, DbErr, Statement};
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::databases::scope::apply_tenant_scope;
use crate::guards::tenant::TenantScope;

/// 一次渠道回调的租户作用域：订单号已反解成租户，事务已升格。
pub struct PaymentNotifyScope {
    scope: TenantScope,
}

impl PaymentNotifyScope {
    /// 按回调携带的订单号反解租户，并在同一事务内进入租户作用域。
    ///
    /// # Errors
    /// 事务无法开启或反解查询失败时返回底层数据库错误（调用方应答渠道「失败」，让它重试）。
    pub async fn open(storage: &Storage, order_no: &str) -> Result<Option<Self>, DbErr> {
        let tx = storage.order_tx(order_no).await?;

        let Some(tenant_id) = resolve(&tx, order_no).await? else {
            tx.rollback().await?;
            return Ok(None);
        };
        apply_tenant_scope(&tx, tenant_id).await?;

        Ok(Some(Self {
            scope: TenantScope::adopt(tx, tenant_id),
        }))
    }

    /// 租户作用域（交给只认作用域的领域函数）。
    #[must_use]
    pub const fn scope(&self) -> &TenantScope {
        &self.scope
    }

    /// 带租户作用域的事务。
    #[must_use]
    pub const fn tx(&self) -> &DatabaseTransaction {
        self.scope.tx()
    }

    /// 反解出的租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.scope.tenant_id()
    }

    /// 提交：核销结果与账务痕迹（已收款标记、关单备注）落库。
    ///
    /// # Errors
    /// 提交失败返回底层数据库错误。
    pub async fn commit(self) -> Result<(), DbErr> {
        self.scope.commit().await
    }

    /// 回滚：这条回调什么都没改，或者改出来的东西不该留下。
    ///
    /// # Errors
    /// 回滚失败返回底层数据库错误。
    pub async fn rollback(self) -> Result<(), DbErr> {
        self.scope.rollback().await
    }
}

/// 订单号 → 租户：走 `uidx_payment_order_no` 唯一索引，只认未归档订单。
async fn resolve(tx: &DatabaseTransaction, order_no: &str) -> Result<Option<TenantId>, DbErr> {
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"SELECT "tenantID" FROM payment_order WHERE "orderNo" = $1 AND "archivedAt" IS NULL"#,
        [order_no.into()],
    );
    let Some(row) = tx.query_one_raw(statement).await? else {
        return Ok(None);
    };
    let tenant_id: Uuid = row.try_get_by_index(0)?;

    Ok(Some(TenantId::from_uuid(tenant_id)))
}
