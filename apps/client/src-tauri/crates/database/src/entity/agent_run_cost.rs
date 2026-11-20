//! 成本账本。列定义的唯一来源；建表语句在 `migrations/run_cost_schema.rs`，
//! 启动兜底与 0001 基线共用那份 SQL，本实体用 `entity_columns_match_ddl` 锁住列名。
//!
//! `price_micros` / `currency` 可空：未知模型记「未计价」，不猜价。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_run_cost")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(column_name = "usageID")]
    pub usage_id: String,
    #[sea_orm(column_name = "runID")]
    pub run_id: Option<String>,
    #[sea_orm(column_name = "sessionID")]
    pub session_id: Option<String>,
    pub model: String,
    #[sea_orm(column_name = "inputTokens")]
    pub input_tokens: i64,
    #[sea_orm(column_name = "outputTokens")]
    pub output_tokens: i64,
    #[sea_orm(column_name = "priceMicros")]
    pub price_micros: Option<i64>,
    pub currency: Option<String>,
    #[sea_orm(column_name = "dayKey")]
    pub day_key: String,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
