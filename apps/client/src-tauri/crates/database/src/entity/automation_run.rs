#![allow(non_snake_case)]

//! 定时任务的执行记录。一次触发行 = 一条记录，`(automationId, scheduledFor)`
//! 上有唯一索引：重复 tick、补跑、多副本都只会落一条。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_run")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(column_name = "automationId")]
    pub automationId: String,
    /// 本次对应的计划时间（epoch ms）；手动执行取触发那一刻
    #[sea_orm(column_name = "scheduledFor")]
    pub scheduledFor: i64,
    /// schedule | manual | catchup
    #[sea_orm(column_name = "triggerKind")]
    pub triggerKind: String,
    /// 本次实际以谁的身份执行（任务定义可能中途改过）
    #[sea_orm(column_name = "runAsKind")]
    pub runAsKind: String,
    #[sea_orm(column_name = "runAsUserId")]
    pub runAsUserId: Option<String>,
    #[sea_orm(column_name = "startedAt")]
    pub startedAt: Option<i64>,
    #[sea_orm(column_name = "finishedAt")]
    pub finishedAt: Option<i64>,
    /// 字典 automation_run_status：001 等待 … 004 失败
    pub status: String,
    /// 智能体最后一段输出（截断后存）
    pub output: Option<String>,
    pub error: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::automation::Entity",
        from = "Column::AutomationId",
        to = "super::automation::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Automation,
}

impl Related<super::automation::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Automation.def()
    }
}
