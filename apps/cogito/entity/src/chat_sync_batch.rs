use sea_orm::entity::prelude::*;

/// 同步批次台账：一批推送的幂等凭据 + 它占用的水位。
///
/// 客户端每批带一个自己生成的 `clientBatchID`。记下它有两个作用：
/// 1. **重发即无操作**：网络抖动下客户端会重发同一批，服务端认出批次后原样回放
///    `revision` 与 `applied`，不再改动任何行（否则每次重发都会推高水位，拉取端看到一堆假变更）；
/// 2. **一批一个水位**：批次是这个协议的最小交付单位，增量拉取按水位整批下发，
///    不会出现「批次只交付了一半」的裂缝。
///
/// `(tenantID, revision)` 唯一：水位在租户内分配，撞了说明有并发批次，调用方重试即可
/// （批次本身幂等，重放是安全的）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "chat_sync_batch")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 客户端生成的批次标识
    #[sea_orm(primary_key, auto_increment = false, column_name = "clientBatchID", column_type = "Text")]
    pub client_batch_id: String,
    /// 本批占用的同步水位
    pub revision: i64,
    /// 本批写入的行数（含墓碑）；回放时原样返回，客户端据此判断「这批到底做了什么」
    pub applied: i32,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
