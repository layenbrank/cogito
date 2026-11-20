//! 本地工具调用审计。列定义的唯一来源；建表语句在 `migrations/tool_audit_schema.rs`，
//! 启动兜底与 0001 基线共用那份 SQL，本实体用 `entity_columns_match_ddl` 锁住列名。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_tool_audit")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(column_name = "toolName")]
    pub tool_name: String,
    pub effect: String,
    pub risk: String,
    pub ok: bool,
    pub error: Option<String>,
    #[sea_orm(column_name = "argsDigest")]
    pub args_digest: String,
    #[sea_orm(column_name = "durationMs")]
    pub duration_ms: i64,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
