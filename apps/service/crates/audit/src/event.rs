//! 领域事件、事件类型与线上信封。
//!
//! 这里只描述「事件是什么」，不认识数据库：存储访问在 `store`，投递在 `publisher`。

use std::{fmt, str::FromStr};

use chrono::{DateTime, FixedOffset, Utc};
use identity::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AuditError;

/// 事件类型：`<聚合>.<过去式动词>` 形式的不可变标识，例如 `subscription.renewed`。
///
/// 类型一经发布就不可改写，也不能复用：老事件会永远留在 outbox 里，
/// 消费者按它分派处理逻辑。
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EventType(String);

impl EventType {
    /// 解析并校验事件类型。
    ///
    /// # Errors
    ///
    /// 不是 `<聚合>.<过去式动词>` 时返回 [`AuditError::InvalidEventType`]。
    pub fn parse(value: &str) -> Result<Self, AuditError> {
        let invalid = || AuditError::InvalidEventType(value.to_owned());
        let Some((aggregate, verb)) = value.split_once('.') else {
            return Err(invalid());
        };
        if !is_segment(aggregate) || !is_segment(verb) || verb.contains('.') {
            return Err(invalid());
        }
        Ok(Self(value.to_owned()))
    }

    /// 事件类型的字面量。
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// 聚合名（`.` 之前的部分）。
    #[must_use]
    pub fn aggregate(&self) -> &str {
        self.0.split_once('.').map_or(&self.0, |(head, _)| head)
    }
}

fn is_segment(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

impl fmt::Display for EventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for EventType {
    type Err = AuditError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

/// 待追加的领域事件。
///
/// 字段与 `outbox` 表列一一对应；`seq`（数据库分配的全序）与发布标记
/// （`publishedAt` / `attempts` / `lastError`）属于存储内部状态，不在本类型里。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// 事件 ID：下游消费者的幂等去重键，由创建方生成（重发必须复用同一个 ID）。
    pub id: Uuid,
    /// 聚合名，如 `subscription`。
    pub aggregate: String,
    /// 聚合标识：同一聚合的事件必须按追加顺序投递。
    pub aggregate_id: Uuid,
    /// 事件类型。
    pub event_type: EventType,
    /// 负载结构版本：负载形状变化时递增，消费者据此兼容。
    pub schema_version: i32,
    /// 事件负载快照：消费者不得回查写入方的当前状态。
    pub payload: serde_json::Value,
    /// 所属租户；`None` 表示平台级事件（跨租户）。
    ///
    /// 注意：`outbox` 已启用行级安全，租户作用域内**只能**写入该作用域自身的租户，
    /// 平台级事件必须在平台通道（`Storage::platform_tx`）内写入。
    pub tenant_id: Option<TenantId>,
    /// W3C `traceparent`，用于跨服务续链。
    pub traceparent: Option<String>,
    /// 事件发生时间（写入方时钟）。
    pub created_at: DateTime<FixedOffset>,
}

impl Event {
    /// 构造一个事件：ID 与时间戳就地生成，`schema_version` 为 1，无租户、无追踪上下文。
    #[must_use]
    pub fn new(
        aggregate: impl Into<String>,
        aggregate_id: Uuid,
        event_type: EventType,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            aggregate: aggregate.into(),
            aggregate_id,
            event_type,
            schema_version: 1,
            payload,
            tenant_id: None,
            traceparent: None,
            created_at: Utc::now().fixed_offset(),
        }
    }

    /// 指定事件 ID（重放/补偿时用来复用既有幂等键）。
    #[must_use]
    pub fn with_id(mut self, id: Uuid) -> Self {
        self.id = id;
        self
    }

    /// 指定所属租户。
    #[must_use]
    pub fn with_tenant(mut self, tenant: TenantId) -> Self {
        self.tenant_id = Some(tenant);
        self
    }

    /// 指定负载结构版本。
    #[must_use]
    pub fn with_schema_version(mut self, schema_version: i32) -> Self {
        self.schema_version = schema_version;
        self
    }

    /// 指定追踪上下文（W3C `traceparent`）。
    #[must_use]
    pub fn with_traceparent(mut self, traceparent: impl Into<String>) -> Self {
        self.traceparent = Some(traceparent.into());
        self
    }
}

/// 投递到下游的线上信封。
///
/// 这是 outbox 行**对外**的形状：字段名与列名一致（camelCase，标识后缀用 `xxxID`），
/// `eventType` 是字符串而非 [`EventType`]——消费者可能与写入方版本不同，解析失败必须
/// 由消费者自己决定如何处理，不能因为本地类型表不认就丢弃事件。内部表结构变化不应改变
/// 本类型。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    /// 事件 ID（幂等去重键）。
    pub id: Uuid,
    /// 聚合名。
    pub aggregate: String,
    /// 聚合标识。
    #[serde(rename = "aggregateID")]
    pub aggregate_id: Uuid,
    /// 事件类型字面量。
    pub event_type: String,
    /// 负载结构版本。
    pub schema_version: i32,
    /// 事件负载。
    pub payload: serde_json::Value,
    /// 所属租户；平台级事件为 `null`。
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<Uuid>,
    /// W3C `traceparent`。
    pub traceparent: Option<String>,
    /// 事件发生时间（RFC 3339）。
    pub created_at: DateTime<FixedOffset>,
}

impl From<&Event> for Envelope {
    fn from(event: &Event) -> Self {
        Self {
            id: event.id,
            aggregate: event.aggregate.clone(),
            aggregate_id: event.aggregate_id,
            event_type: event.event_type.as_str().to_owned(),
            schema_version: event.schema_version,
            payload: event.payload.clone(),
            tenant_id: event.tenant_id.map(|tenant| tenant.as_uuid()),
            traceparent: event.traceparent.clone(),
            created_at: event.created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_type_accepts_aggregate_dot_verb() {
        for value in [
            "subscription.renewed",
            "payment_order.paid",
            "tenant_member.removed",
            "gateway_usage.recorded2",
        ] {
            let parsed = EventType::parse(value).expect("应被接受");
            assert_eq!(parsed.as_str(), value);
        }
        assert_eq!(
            EventType::parse("payment_order.paid")
                .expect("应被接受")
                .aggregate(),
            "payment_order"
        );
    }

    #[test]
    fn event_type_rejects_malformed_names() {
        for value in [
            "",
            "subscription",
            ".renewed",
            "subscription.",
            "subscription.Renewed",
            "Subscription.renewed",
            "subscription.re-newed",
            "subscription.renewed.twice",
            "1subscription.renewed",
            "订阅.renewed",
        ] {
            let error = EventType::parse(value).expect_err("应被拒绝");
            assert!(
                matches!(error, AuditError::InvalidEventType(ref text) if text == value),
                "{value} 应报 InvalidEventType"
            );
        }
    }

    #[test]
    fn envelope_uses_the_outbox_wire_keys() {
        let event = Event::new(
            "subscription",
            Uuid::nil(),
            EventType::parse("subscription.renewed").expect("合法类型"),
            serde_json::json!({ "plan": "TEAM" }),
        )
        .with_tenant(TenantId::from_uuid(Uuid::max()));

        let value = serde_json::to_value(Envelope::from(&event)).expect("序列化");
        let object = value.as_object().expect("信封是对象");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "aggregate",
                "aggregateID",
                "createdAt",
                "eventType",
                "id",
                "payload",
                "schemaVersion",
                "tenantID",
                "traceparent",
            ],
            "线上字段名是对外契约，改名等于破坏兼容"
        );
        assert_eq!(value["eventType"], "subscription.renewed");
        assert_eq!(value["aggregateID"], Uuid::nil().to_string());
        assert_eq!(value["tenantID"], Uuid::max().to_string());
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["payload"]["plan"], "TEAM");
        assert_eq!(value["traceparent"], serde_json::Value::Null);
        // 时间戳按 RFC 3339 发出（偏移写 `Z` 还是 `+00:00` 由 chrono 决定，两者等价）
        let created_at = value["createdAt"].as_str().expect("createdAt 是字符串");
        assert_eq!(
            DateTime::parse_from_rfc3339(created_at).expect("合法的 RFC 3339"),
            event.created_at,
            "createdAt 必须还原成同一时刻"
        );
    }

    #[test]
    fn platform_event_has_null_tenant() {
        let event = Event::new(
            "tenant",
            Uuid::nil(),
            EventType::parse("tenant.created").expect("合法类型"),
            serde_json::Value::Null,
        );
        assert_eq!(Envelope::from(&event).tenant_id, None);
        assert_eq!(event.schema_version, 1, "默认负载版本从 1 开始");
    }
}
