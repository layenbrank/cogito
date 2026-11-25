use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 图库根目录（「文件夹是真相」的那批目录）。
///
/// 存库而不是存偏好文件：watcher 在 Rust 侧启动时要直接读它，不该依赖渲染进程先上报。
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "galleryRoot")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub path: String,
    #[sea_orm(column_name = "addedAt")]
    pub added_at: i64,
    #[sea_orm(column_name = "lastScanAt")]
    pub last_scan_at: Option<i64>,
    /// 1 = 监听中；0 = 只做手动重扫
    #[sea_orm(column_name = "isWatching")]
    pub is_watching: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
