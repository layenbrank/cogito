use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

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
