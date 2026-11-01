use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 全局池条目（管理面 / 合并视图）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemR {
    pub value: String,
    pub key: String,
    pub label: String,
    pub sort: i32,
    pub enabled: bool,
    pub meta: Option<String>,
    pub revision: i32,
}

/// 类型下已认领条目（合并后的展示字段）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TypeItemR {
    pub value: String,
    pub key: String,
    pub label: String,
    pub sort: i32,
    pub enabled: bool,
    pub is_default: bool,
    pub meta: Option<String>,
    pub revision: i32,
}

/// 字典类型（含认领条目）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TypeR {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<TypeItemR>,
}

/// 新建字典类型
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TypeP {
    pub code: String,
    pub name: String,
    pub description: Option<String>,
}

/// 更新字典类型元数据
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TypeUpdateP {
    pub name: String,
    pub description: Option<String>,
}

/// 分配下一全局 value
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemAllocateP {
    pub key: String,
    pub label: String,
    pub sort: Option<i32>,
    pub meta: Option<String>,
}

/// 更新全局池条目（不改 value / key）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdateP {
    pub label: Option<String>,
    pub sort: Option<i32>,
    pub enabled: Option<bool>,
    pub meta: Option<String>,
}

/// 为类型认领池 value
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaimP {
    pub value: String,
    pub is_default: bool,
    pub sort: i32,
    pub label: Option<String>,
}

/// 租户级覆盖写入项
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantItemP {
    pub type_code: String,
    pub value: String,
    pub label: Option<String>,
    pub enabled: Option<bool>,
}

/// 租户合并视图（管理面）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantViewR {
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub revision: i32,
    pub types: Vec<TypeR>,
}

/// 当前租户字典目录（成员面）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CatalogR {
    pub revision: i32,
    pub types: Vec<TypeR>,
}
