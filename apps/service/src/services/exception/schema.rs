use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// 异常级别（对齐 Sentry；无 debug）
pub const LEVELS: &[&str] = &["fatal", "error", "warning", "info"];

/// 客户端上报请求体
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[schema(as = ExceptionWriteP)]
#[serde(rename_all = "camelCase")]
pub struct WriteP {
    /// 客户端生成的事件 UUID（幂等键；服务端不代填）
    #[serde(rename = "eventID")]
    pub event_id: String,
    /// 错误消息摘要（≤2000）
    pub message: String,
    /// 异常发生毫秒时间戳
    pub timestamp: i64,
    /// 页面 / 接口 URL
    pub url: String,
    /// 堆栈（≤20000）
    #[serde(default)]
    pub stack: Option<String>,
    /// fatal | error | warning | info；缺省 error
    #[serde(default)]
    pub level: Option<String>,
    /// HTTP 状态码 100–599
    #[serde(default)]
    pub status: Option<i32>,
    /// HTTP 方法（≤16）
    #[serde(default)]
    pub method: Option<String>,
    /// 请求链路 ID（≤128）
    #[serde(default, rename = "reqID")]
    pub req_id: Option<String>,
    /// 客户端 IP（≤64）
    #[serde(default)]
    pub ip: Option<String>,
    /// User-Agent（≤500）
    #[serde(default, rename = "userAgent")]
    pub user_agent: Option<String>,
    /// 业务用户 ID（≤128）；有 Session 且为空时由服务端填充
    #[serde(default, rename = "userID")]
    pub user_id: Option<String>,
    /// 运行环境（≤32）
    #[serde(default)]
    pub environment: Option<String>,
    /// 应用版本（≤64）
    #[serde(default)]
    pub release: Option<String>,
    /// 扩展上下文
    #[serde(default)]
    pub context: Option<Value>,
    /// 聚合指纹（≤64）；缺省服务端按 message|url|status 生成
    #[serde(default)]
    pub fingerprint: Option<String>,
    /// 来源项目名（≤64）；缺省 client
    #[serde(default)]
    pub source: Option<String>,
}

/// 列表 / 聚合共用查询参数
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[schema(as = ExceptionQueryP)]
#[serde(rename_all = "camelCase")]
pub struct QueryP {
    /// 分页大小 1–100，默认 50
    #[serde(default)]
    pub take: Option<u64>,
    /// 偏移，默认 0
    #[serde(default)]
    pub skip: Option<u64>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub fingerprint: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    /// message / url 模糊搜索（≤200）
    #[serde(default)]
    pub q: Option<String>,
    /// 入库时间下界（ISO8601）
    #[serde(default)]
    pub received_from: Option<String>,
    /// 入库时间上界（ISO8601）
    #[serde(default)]
    pub received_to: Option<String>,
}

/// 单条异常事件响应
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExceptionR {
    pub id: String,
    #[serde(rename = "eventID")]
    pub event_id: String,
    pub fingerprint: String,
    pub source: String,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "reqID")]
    pub req_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "userAgent")]
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "userID")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Value>,
    pub timestamp: i64,
    /// 入库毫秒时间戳
    #[serde(rename = "receivedAt")]
    pub received_at: i64,
}

/// 分页列表
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageR {
    pub items: Vec<ExceptionR>,
    pub total: u64,
}

/// 按 fingerprint 聚合的 Issue
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupR {
    pub fingerprint: String,
    pub count: u64,
    #[serde(rename = "lastSeen")]
    pub last_seen: i64,
    #[serde(rename = "firstSeen")]
    pub first_seen: i64,
    pub message: String,
    pub level: String,
    pub source: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i32>,
}

/// Issue 分页
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupPageR {
    pub items: Vec<GroupR>,
    pub total: u64,
}

/// 汇总统计
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryR {
    pub total: u64,
    pub by_level: std::collections::BTreeMap<String, u64>,
    pub by_source: std::collections::BTreeMap<String, u64>,
}
