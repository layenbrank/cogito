use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// 概览指标。数字与各列表的全量计数对齐，不在浏览器里抽样。
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryR {
    pub users: u64,
    pub tenants: u64,
    /// fatal + error
    pub open_exceptions: u64,
    /// agent 台账 status = 015
    pub running_agents: u64,
    /// rag 台账 status = 009
    pub running_indexes: u64,
}

/// 控制台偏好写入 / 覆盖（upsert）
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceP {
    /// 侧栏模块 id 有序数组
    pub nav_order: Vec<String>,
    /// 钉选模块 id
    pub pinned_nav: Vec<String>,
    /// 概览小部件布局
    pub dashboard_widgets: Vec<String>,
    /// 深链书签
    pub bookmarks: Vec<Value>,
}

/// 控制台偏好响应
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceR {
    pub id: String,
    #[serde(rename = "userID")]
    pub user_id: String,
    pub nav_order: Vec<String>,
    pub pinned_nav: Vec<String>,
    pub dashboard_widgets: Vec<String>,
    pub bookmarks: Vec<Value>,
    /// 毫秒时间戳
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}
