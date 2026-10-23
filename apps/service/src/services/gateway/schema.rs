use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

/// OpenAI 兼容 chat/completions 请求；`model` 用于解析上游，其余字段原样透传。
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatCompletionsP {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    /// messages / tools / temperature / … 原样透传给上游供应商
    #[serde(flatten)]
    pub extra: Map<String, serde_json::Value>,
}

/// OpenAI 兼容 embeddings 请求：`input`/`dimensions`/… 由调用方透传，**模型名不由客户端决定**。
///
/// `model` 只做一致性校验（与令牌作用域不符即 400）——真正生效的模型来自服务令牌，
/// 这样一枚令牌就只能用在自己被授权的那一个模型上。
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingsP {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// input / dimensions / encoding_format / … 原样透传给上游供应商
    #[serde(flatten)]
    pub extra: Map<String, serde_json::Value>,
}

/// 服务令牌申请：作用域由 cogito 判定，调用方只能**请求**租户、作用域与时长。
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTokenP {
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// 作用域：`embeddings`（缺省，嵌入出站）、`asset-read`（读单个资产内容）、`chat`（聊天出站）
    /// 或 `asset-write`（按一次已批准的审批改单个资产的可见性）。
    pub scope: Option<String>,
    /// `scope=embeddings` / `scope=chat` 时必填：令牌只对这个模型有效。
    pub model: Option<String>,
    /// `scope=asset-read` / `scope=asset-write` 时必填：令牌只对这个资产有效。
    #[serde(rename = "assetID")]
    pub asset_id: Option<String>,
    /// `scope=asset-write` 时必填：这次写依据的审批。cogito 会核对「批的就是这个资产、批的人
    /// 是它的创建者」，并把审批原文里的可见性与名单钉进令牌。
    #[serde(rename = "approvalID")]
    pub approval_id: Option<String>,
    /// 期望有效期（秒）；缺省用配置值，且一律被上限收敛。
    pub ttl_secs: Option<u64>,
}

/// 服务令牌响应：裸结构、不套信封（调用方是服务进程，不是浏览器）。
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTokenR {
    pub token: String,
    /// 过期时间（Unix 秒），调用方据此决定何时续签。
    pub expires_at: i64,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// 实际生效的作用域（`embeddings` / `asset-read` / `chat` / `asset-write`）。
    pub scope: String,
    /// 仅 `scope=embeddings` / `scope=chat` 有值。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 仅 `scope=asset-read` / `scope=asset-write` 有值。
    #[serde(rename = "assetID", skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// 仅 `scope=asset-write` 有值：回执里带上是哪张单子换来的这枚令牌，便于对账。
    #[serde(rename = "approvalID", skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    /// 固定为 `cogito`，与用户会话令牌区分。
    pub token_type: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWriteP {
    /// openai / anthropic / deepseek / qwen / zhipu / ollama
    pub kind: String,
    pub name: String,
    pub base_url: String,
    /// 明文 API Key；入库前 AES 加密
    pub api_key: Option<String>,
    /// ACTIVE / DISABLED
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdateP {
    pub kind: Option<String>,
    pub name: Option<String>,
    pub base_url: Option<String>,
    /// 提供时重新加密；缺省保留原密钥
    pub api_key: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderR {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub base_url: String,
    pub status: String,
    /// 是否已托管密钥（不回传明文/密文）
    pub has_api_key: bool,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelWriteP {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    /// 模型标识（如 gpt-4o）
    pub name: String,
    pub label: String,
    /// 允许调用的角色；空 = 全角色放行
    pub allow_roles: Option<Vec<String>>,
    pub enabled: Option<bool>,
    /// 日 token 配额；0 = 继承租户
    pub daily_token_quota: Option<i64>,
    /// 能力声明（`{"tools":true,"reasoning":true,"vision":false}`）；缺省 = 未声明
    #[schema(value_type = Object, nullable = true)]
    pub capabilities: Option<Value>,
    /// 上下文窗口（token）；缺省或 ≤ 0 = 未知
    pub context_window: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpdateP {
    pub name: Option<String>,
    pub label: Option<String>,
    pub allow_roles: Option<Vec<String>>,
    pub enabled: Option<bool>,
    pub daily_token_quota: Option<i64>,
    /// 提供即覆盖；空对象 / null 表示清空声明
    #[schema(value_type = Object, nullable = true)]
    pub capabilities: Option<Value>,
    /// 提供即覆盖；≤ 0 表示清空（未知）
    pub context_window: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelR {
    pub id: String,
    #[serde(rename = "providerID")]
    pub provider_id: String,
    pub name: String,
    pub label: String,
    pub allow_roles: Option<Vec<String>>,
    pub enabled: bool,
    pub daily_token_quota: i64,
    /// 能力声明；未声明时不下发（客户端按默认兜底）
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object, nullable = true)]
    pub capabilities: Option<Value>,
    /// 上下文窗口（token）；未知时不下发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    /// 上游供应商展示名。用户面目录下发给**所有**登录用户（含非管理员，
    /// 他们读不到 `/gateway/providers`），客户端据此展示模型挂在谁家。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsageQueryP {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[serde(rename = "modelID")]
    pub model_id: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub page: Option<u32>,
    pub size: Option<u32>,
}

/// 审计日志查询参数（平台面「跨租户汇总」与租户面「本租户」共用）。
///
/// 平台面用 `tenantID` 收窄到某个租户；租户面的租户由路径与作用域决定，传了不一致的值即 400。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditQueryP {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    /// 操作者用户 ID（精确匹配）
    pub actor: Option<String>,
    /// 动作（精确匹配，如 `gateway.chat`）
    pub action: Option<String>,
    /// 起始毫秒时间戳（含）
    pub from: Option<i64>,
    /// 结束毫秒时间戳（含）
    pub to: Option<i64>,
    pub page: Option<u32>,
    pub size: Option<u32>,
}

/// 审计导出参数：与列表同一组过滤条件，外加导出格式（缺省 CSV）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditExportP {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub actor: Option<String>,
    pub action: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub format: Option<AuditExportFormat>,
}

/// 导出格式：`csv`（Excel 友好，带 UTF-8 BOM）或 `ndjson`（SIEM / 流式消费友好）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AuditExportFormat {
    Csv,
    Ndjson,
}

/// 审计查询的过滤条件：**可见性由作用域决定**，这里只做收窄。
///
/// 与查询参数分成两个类型是因为 `web::Query` 走 `serde_urlencoded`，它不支持
/// `#[serde(flatten)]`——把「已解析、已校验」的条件与「字符串形态的入参」分开，
/// 列表与导出两条路径才能共用同一段查询实现。
#[derive(Debug, Clone, Default)]
pub struct AuditFilter {
    /// 平台面的租户收窄；租户面为 `None`（作用域已经把可见性收口到本租户）
    pub tenant_id: Option<uuid::Uuid>,
    pub actor: Option<uuid::Uuid>,
    pub action: Option<String>,
    pub from: Option<chrono::DateTime<chrono::FixedOffset>>,
    pub to: Option<chrono::DateTime<chrono::FixedOffset>>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsageR {
    pub id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[serde(rename = "userID")]
    pub user_id: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub status: String,
    pub latency_ms: i64,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditR {
    pub id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub actor: String,
    pub action: String,
    pub resource: String,
    pub detail: Option<serde_json::Value>,
    pub ip: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

/// 自助配额查询参数。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelfQuotaP {
    /// 目录里的模型名；缺省（或 `auto`）时按身份级配额回答
    pub model: Option<String>,
}

/// 当前身份此刻的日窗配额状态（只读：不改计数、不落库）。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelfQuotaR {
    /// 配额归属：`TENANT`（有租户身份）/ `USER`（无租户身份）
    pub scope: String,
    #[serde(rename = "scopeID")]
    pub scope_id: String,
    #[serde(rename = "tenantID", skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    /// 归属租户类型：`PERSONAL` / `TEAM`；无租户身份时不发
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_type: Option<String>,
    /// 上限来源：`MODEL` 单模型覆盖 / `PLAN` 订阅档位 / `FREE` 免费档 / `GLOBAL` 全局兜底
    pub source: String,
    /// 档位名；仅 `PLAN` 有
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// 日配额上限（token）
    pub limit: i64,
    /// 今日已用（token，取 Redis 日窗计数）
    pub used: i64,
    /// 剩余（不小于 0）
    pub remaining: i64,
    /// 是否已触顶；触顶后平台模型的新请求会被拒（400006）
    pub exhausted: bool,
    /// 日窗重置时刻（毫秒时间戳）
    #[serde(rename = "resetsAt")]
    pub resets_at: i64,
}

/// 可开通档位：配额数字来自 `gateway.plan_daily_token_quota`，不落库。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanR {
    pub plan: String,
    #[serde(rename = "dailyTokenQuota")]
    pub daily_token_quota: i64,
}

/// 档位目录：可开通档位 + 免费档基线。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlansR {
    pub plans: Vec<PlanR>,
    #[serde(rename = "freeDailyTokenQuota")]
    pub free_daily_token_quota: i64,
}
