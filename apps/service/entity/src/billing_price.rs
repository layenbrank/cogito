use sea_orm::entity::prelude::*;

/// 模型价目表：`(租户, 型号, 有效区间)` → 单价（**分 / 百万 token**）。
///
/// 网关只记用量（token 数），金额由对账时按本表折算，因此价格必须**可回溯**：
/// 取价按 `effectiveFrom <= 用量时间 < effectiveTo` 命中历史那一条，改价即新增区间。
/// `tenantID` 为 NULL 是平台默认价，非空是该租户的专属价（同层级优先）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "billing_price")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// NULL = 平台默认价；非 NULL = 该租户专属价（命中时优先于平台默认价）
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Option<Uuid>,
    /// 被计价的网关型号 ID（指向 `gateway_model.id`，但不设外键：见 `model_name`）
    #[sea_orm(column_name = "modelID", indexed)]
    pub model_id: Uuid,
    /// 型号名的写入时快照：报告展示用，避免对账依赖别的能力域当时的行
    #[sea_orm(column_name = "modelName", column_type = "Text")]
    pub model_name: String,
    /// 币种，需与订单币种一致（跨币种对账无意义）
    #[sea_orm(column_type = "Text")]
    pub currency: String,
    /// 输入单价（分 / 百万 token）
    #[sea_orm(column_name = "inputPricePerMillion")]
    pub input_price_per_million: i64,
    /// 输出单价（分 / 百万 token）
    #[sea_orm(column_name = "outputPricePerMillion")]
    pub output_price_per_million: i64,
    /// 生效起点（含）
    #[sea_orm(column_name = "effectiveFrom")]
    pub effective_from: DateTimeWithTimeZone,
    /// 生效终点（不含）；NULL = 至今
    #[sea_orm(column_name = "effectiveTo", nullable)]
    pub effective_to: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "archivedAt", nullable)]
    pub archived_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
    pub updater: Option<Uuid>,
}

impl ActiveModelBehavior for ActiveModel {}
