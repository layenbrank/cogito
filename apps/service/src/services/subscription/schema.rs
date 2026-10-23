use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 开通 / 续订请求。同一租户同一时刻最多一条生效订阅，重复调用即续订。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeP {
    /// 档位名（须存在于 `gateway.plan_daily_token_quota`）
    pub plan: String,
    /// 到期时间（毫秒时间戳）；缺省或 null 为永久有效
    pub expires_at: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionR {
    pub id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub plan: String,
    pub status: String,
    /// 到期时间；null = 永久有效
    pub expires_at: Option<i64>,
    /// 订阅创建即生效，故也是生效开始时间
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// 租户当前生效的日 token 配额。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuotaR {
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// PERSONAL / TEAM
    #[serde(rename = "type")]
    pub tenant_type: String,
    /// PLAN（生效订阅档位）/ FREE（免费档）/ GLOBAL（全局兜底）
    pub source: String,
    /// 生效档位名；`source != PLAN` 时为 null
    pub plan: Option<String>,
    /// 当前生效的日 token 配额（单模型可用 `gateway_model.dailyTokenQuota` 另行覆盖）
    pub daily_token_quota: i64,
}
