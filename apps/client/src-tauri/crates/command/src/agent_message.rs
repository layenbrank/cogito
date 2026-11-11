#![allow(non_snake_case)]

use cogito_core::agent_message::Service;
use cogito_core::{CommandResult, Exception};
use cogito_database::Storage;
use cogito_database::entity::agent_message::{Model, Read, ReadP, RemoveP, UpdateP, WriteP};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[tauri::command(rename = "agentMessage:toWrite")]
pub async fn agentMessageToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentMessage:toRead")]
pub async fn agentMessageToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentMessage:toUpdate")]
pub async fn agentMessageToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentMessage:toRemove")]
pub async fn agentMessageToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}

/// 与 packages/chat `LOCAL_FORMAT` 对齐
const LOCAL_FORMAT: &str = "ith/thread-message-like";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadThreadP {
    pub session_id: String,
    /// 是否剥掉队尾 detach stub（resume 前为 true）
    #[serde(default)]
    pub scrub_detach: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadHistoryItem {
    pub parent_id: Option<String>,
    pub message: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadThreadR {
    pub head_id: Option<String>,
    pub messages: Vec<ThreadHistoryItem>,
}

fn is_cancelled_assistant(payload: &Value) -> bool {
    let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
    if role != "assistant" {
        return false;
    }
    let Some(status) = payload.get("status") else {
        return false;
    };
    let status_type = status.get("type").and_then(Value::as_str).unwrap_or("");
    if status_type == "running" {
        return true;
    }
    if status_type == "incomplete" {
        return status.get("reason").and_then(Value::as_str) == Some("cancelled");
    }
    false
}

/// 剥掉队尾因 detach 留下的取消/运行中助手（对齐 TS `scrubDetachStubs`）
fn scrub_detach_stubs(mut items: Vec<ThreadHistoryItem>) -> Vec<ThreadHistoryItem> {
    while let Some(last) = items.last() {
        if !is_cancelled_assistant(&last.message) {
            break;
        }
        items.pop();
    }
    items
}

fn find_head_id(items: &[ThreadHistoryItem]) -> Option<String> {
    let parent_ids: std::collections::HashSet<&str> = items
        .iter()
        .filter_map(|item| item.parent_id.as_deref())
        .collect();
    for item in items.iter().rev() {
        let id = item.message.get("id").and_then(Value::as_str)?;
        if !parent_ids.contains(id) {
            return Some(id.to_string());
        }
    }
    None
}

fn decode_row(row: &Model) -> Option<ThreadHistoryItem> {
    if row.format != LOCAL_FORMAT {
        return None;
    }
    let mut payload: Value = match serde_json::from_str(&row.content) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(
                "agentMessage:loadThread 跳过无法解码的行 {}: {error}",
                row.id
            );
            return None;
        }
    };
    if let Some(object) = payload.as_object_mut() {
        object.insert("id".into(), Value::String(row.id.clone()));
    } else {
        return None;
    }
    Some(ThreadHistoryItem {
        parent_id: row.parentID.clone(),
        message: payload,
    })
}

#[tauri::command(rename = "agentMessage:loadThread")]
pub async fn agentMessageLoadThread(
    state: State<'_, Storage>,
    params: LoadThreadP,
) -> CommandResult<LoadThreadR> {
    let session_id = params.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(Exception::Validation("sessionId 不能为空".into()));
    }
    let rows = Service::toRead(
        state.connection(),
        ReadP::One(Read {
            id: None,
            sessionID: Some(session_id),
        }),
    )
    .await?;

    let mut items: Vec<ThreadHistoryItem> = rows.iter().filter_map(decode_row).collect();
    if params.scrub_detach {
        items = scrub_detach_stubs(items);
    }
    let head_id = find_head_id(&items);
    Ok(LoadThreadR {
        head_id,
        messages: items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scrub_strips_trailing_cancelled_assistant() {
        let items = vec![
            ThreadHistoryItem {
                parent_id: None,
                message: json!({ "id": "u1", "role": "user" }),
            },
            ThreadHistoryItem {
                parent_id: Some("u1".into()),
                message: json!({
                    "id": "a1",
                    "role": "assistant",
                    "status": { "type": "incomplete", "reason": "cancelled" }
                }),
            },
        ];
        let scrubbed = scrub_detach_stubs(items);
        assert_eq!(scrubbed.len(), 1);
        assert_eq!(scrubbed[0].message["id"], "u1");
    }

    #[test]
    fn find_head_skips_parents() {
        let items = vec![
            ThreadHistoryItem {
                parent_id: None,
                message: json!({ "id": "u1", "role": "user" }),
            },
            ThreadHistoryItem {
                parent_id: Some("u1".into()),
                message: json!({ "id": "a1", "role": "assistant" }),
            },
        ];
        assert_eq!(find_head_id(&items).as_deref(), Some("a1"));
    }
}
