//! rag 索引任务的请求 / 响应契约。
//!
//! 台账行是出参的形状来源（`rag_index_task`），所以这里的字段名与列名一一对应——中间加一层
//! 「视图模型」只会多一个漂移点。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// 起索引任务请求。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IndexTaskP {
    /// 要索引的资产 id；资产必须已完成上传且未归档
    #[serde(rename = "assetID")]
    pub asset_id: String,
}

/// 索引任务台账行。
///
/// 出参里没有「轮次」「批数」这类过程量：索引的批数随资产大小而变，写死一个数字只会
/// 误导调用方；实时进度看 `progress`，最终规模看 `result`。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IndexTaskR {
    pub id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// 发起人；服务身份触发时为 null
    #[serde(rename = "userID")]
    pub user_id: Option<String>,
    #[serde(rename = "assetID")]
    pub asset_id: String,
    /// `RUNNING` / `SUCCEEDED` / `FAILED`
    pub status: String,
    /// 编排自报的进度原文（`chunked:n` / `embedded:to` / `indexed`）；还在跑且问得到时才有
    pub progress: Option<String>,
    /// 编排输出快照（`chunkSetID` / `chunkCount` / `batches` / `dimensions` / `indexed` / `collection`）；成功后才有
    #[schema(value_type = Object, nullable = true)]
    pub result: Option<Value>,
    /// 失败原因（已分类的运维文案）；失败后才有
    pub error: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}
