use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "asset")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,

    #[serde(rename = "tenantID")]
    #[sea_orm(column_name = "tenantID")]
    pub tenant_id: Option<String>,

    pub kind: Option<String>,
    pub hash: Option<String>,
    pub sha: String,
    pub size: Option<i64>,
    pub index: i64,
    pub mime: String,
    pub extension: Option<String>,

    #[sea_orm(column_name = "fileName")]
    pub file_name: String,

    #[sea_orm(column_name = "filePath")]
    pub file_path: String,

    pub metadata: Option<String>,
    /// 字典 asset_status：001 正常
    pub status: String,

    #[serde(rename = "deviceID")]
    #[sea_orm(column_name = "deviceID")]
    pub device_id: Option<String>,

    #[sea_orm(column_name = "archivedAt")]
    pub archived_at: Option<i64>,

    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,

    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// 查询条件；可选 `limit` / `offset` 用于列表。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub kind: Option<String>,
    pub id: Option<String>,
    pub hash: Option<String>,
    pub mime: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "deviceID")]
    pub device_id: Option<String>,
    pub extension: Option<String>,
    #[serde(rename = "fileName")]
    pub file_name: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReadP {
    One(Read),
    Many(Vec<Read>),
}

/// 写入体；`index` 可由服务默认。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Insert {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub kind: Option<String>,
    pub hash: Option<String>,
    pub sha: Option<String>,
    pub size: Option<i64>,
    pub index: Option<i64>,
    pub mime: String,
    #[serde(default)]
    pub extension: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub metadata: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "deviceID")]
    pub device_id: Option<String>,
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InsertP {
    One(Insert),
    Many(Vec<Insert>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertR {
    pub id: String,
}

/// 更新字段（全量覆盖语义，同原 Insert 体）。
pub type Change = Insert;

/// `{ id, updates }`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub id: String,
    pub updates: Change,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpdateP {
    One(Update),
    Many(Vec<Update>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedAtFilter {
    pub operator: String,
    pub value: i64,
}

/// 删除过滤条件。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remove {
    pub id: Option<String>,
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub kind: Option<String>,
    pub hash: Option<String>,
    pub mime: Option<String>,
    pub extension: Option<String>,
    #[serde(rename = "fileName")]
    pub file_name: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "deviceID")]
    pub device_id: Option<String>,
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<ArchivedAtFilter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveP {
    One(Remove),
    Many(Vec<Remove>),
}
