//! 网关领域的落库（用量/审计）。

use anyhow::Result;
use chrono::Utc;
use entity::{gateway_audit, gateway_usage};
use sea_orm::{ActiveModelTrait, DatabaseTransaction, Set};
use serde_json::Value;
use uuid::Uuid;

/// 一次模型调用的用量输入。
pub struct UsageInput {
    pub tenant_id: Option<Uuid>,
    pub user_id: Uuid,
    pub provider_id: Uuid,
    pub model_id: Uuid,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub status: String,
    pub latency_ms: i64,
}

/// 落一行用量；事务由调用方提供（必须是租户或账号作用域，否则策略会挡下写入）。
pub async fn record_usage(
    tx: &DatabaseTransaction,
    input: &UsageInput,
) -> Result<Uuid, sea_orm::DbErr> {
    let id = Uuid::new_v4();
    gateway_usage::ActiveModel {
        id: Set(id),
        tenant_id: Set(input.tenant_id),
        user_id: Set(input.user_id),
        provider_id: Set(input.provider_id),
        model_id: Set(input.model_id),
        prompt_tokens: Set(input.prompt_tokens),
        completion_tokens: Set(input.completion_tokens),
        total_tokens: Set(input.total_tokens),
        status: Set(input.status.clone()),
        latency_ms: Set(input.latency_ms),
        created_at: Set(Utc::now().fixed_offset()),
    }
    .insert(tx)
    .await?;
    Ok(id)
}

/// 落一行审计；事务由调用方提供（必须是租户或账号作用域）。
pub async fn record_audit(
    tx: &DatabaseTransaction,
    tenant_id: Option<Uuid>,
    actor: Uuid,
    action: &str,
    resource: &str,
    detail: Option<Value>,
    ip: Option<String>,
) -> Result<(), sea_orm::DbErr> {
    gateway_audit::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(tenant_id),
        actor: Set(actor),
        action: Set(action.to_string()),
        resource: Set(resource.to_string()),
        detail: Set(detail),
        ip: Set(ip),
        created_at: Set(Utc::now().fixed_offset()),
    }
    .insert(tx)
    .await?;
    Ok(())
}
