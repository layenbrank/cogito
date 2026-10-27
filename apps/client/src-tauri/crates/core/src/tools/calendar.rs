//! `app_calendar_read`：按 epoch 毫秒区间读日程。
//!
//! 只读；写入仍走 `calendar:write` + 前端预览确认，agent 没有写工具。
use cogito_database::entity::calendar as schema;
use sea_orm::DatabaseConnection;
use serde_json::{Value, json};

use super::{Effect, ToolSpec, describe};
use crate::calendar::Service;

pub const NAME: &str = "app_calendar_read";

#[must_use]
pub fn spec() -> ToolSpec {
    describe(
        NAME,
        "读取指定时间区间内的日程（epoch 毫秒；省略则不限）。返回按开始时间升序的日程数组。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "from": { "type": "integer", "description": "区间起点（epoch ms，含）" },
                "to": { "type": "integer", "description": "区间终点（epoch ms，含）" }
            },
            "additionalProperties": false
        }),
    )
}

pub async fn call(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let params = schema::ReadP::One(schema::Read {
        id: None,
        title: None,
        reminder_id: None,
        archived: false,
        range_from: arguments.get("from").and_then(Value::as_i64),
        range_to: arguments.get("to").and_then(Value::as_i64),
    });
    let rows = Service::toRead(db, params)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::to_value(rows).map_err(|error| error.to_string())
}
