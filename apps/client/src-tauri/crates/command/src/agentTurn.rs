#![allow(non_snake_case)]

//! 按 thread 有界的回合事件环缓冲：替代 WebView 内无限 `events[]`。
//!
//! TS ACP 泵 `append`；UI / resume 用 `follow` 按 cursor 拉批量增量；
//! running 集合也落在这里，刷新后比 localStorage 更可靠。

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use cogito_core::{CommandResult, Exception};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 单回合最多保留的事件条数（与 TS 过渡期 `TURN_EVENT_CAP` 对齐量级）
const MAX_EVENTS: usize = 4_000;
/// 单回合近似字节上限（序列化后粗估）
const MAX_BYTES: usize = 8 * 1024 * 1024;
/// tool-result / tool-call input 单字段截断长度
const TOOL_PAYLOAD_CAP: usize = 8_192;
/// Done 回合保留窗口（与 TS `TURN_RETENTION_MS` 对齐）；过期后从 hub 淘汰
const DONE_RETENTION: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    Running,
    Done,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowR {
    pub events: Vec<Value>,
    pub next_cursor: u64,
    pub status: TurnStatus,
}

struct StoredEvent {
    cursor: u64,
    payload: Value,
    approx_bytes: usize,
}

struct TurnBuffer {
    events: VecDeque<StoredEvent>,
    next_cursor: u64,
    status: TurnStatus,
    approx_bytes: usize,
    finished_at: Option<Instant>,
}

impl TurnBuffer {
    fn fresh() -> Self {
        Self {
            events: VecDeque::new(),
            next_cursor: 0,
            status: TurnStatus::Running,
            approx_bytes: 0,
            finished_at: None,
        }
    }

    fn push(&mut self, raw: Value) {
        let payload = scrub_tool_payloads(raw);
        let approx_bytes = approx_value_bytes(&payload);
        self.events.push_back(StoredEvent {
            cursor: self.next_cursor,
            payload,
            approx_bytes,
        });
        self.next_cursor = self.next_cursor.saturating_add(1);
        self.approx_bytes = self.approx_bytes.saturating_add(approx_bytes);
        self.trim();
    }

    fn trim(&mut self) {
        while self.events.len() > MAX_EVENTS || self.approx_bytes > MAX_BYTES {
            if self.events.len() <= 1 {
                // 至少留一条（终态 / 最新），再大也只能硬截字段
                if let Some(front) = self.events.front_mut() {
                    front.payload = truncate_value(front.payload.clone(), TOOL_PAYLOAD_CAP / 2);
                    front.approx_bytes = approx_value_bytes(&front.payload);
                    self.approx_bytes = front.approx_bytes;
                }
                break;
            }
            if let Some(dropped) = self.events.pop_front() {
                self.approx_bytes = self.approx_bytes.saturating_sub(dropped.approx_bytes);
            }
        }
    }

    fn follow_from(&self, cursor: u64) -> FollowR {
        let events: Vec<Value> = self
            .events
            .iter()
            .filter(|item| item.cursor >= cursor)
            .map(|item| item.payload.clone())
            .collect();
        FollowR {
            events,
            next_cursor: self.next_cursor,
            status: self.status,
        }
    }
}

struct Hub {
    turns: HashMap<String, TurnBuffer>,
    running: HashSet<String>,
}

impl Hub {
    fn new() -> Self {
        Self {
            turns: HashMap::new(),
            running: HashSet::new(),
        }
    }

    /// 丢掉过期的 Done 缓冲，避免长会话按 thread 无限堆积。
    fn prune_expired(&mut self) {
        let now = Instant::now();
        let expired: Vec<String> = self
            .turns
            .iter()
            .filter_map(|(id, turn)| {
                if turn.status != TurnStatus::Done {
                    return None;
                }
                let finished_at = turn.finished_at?;
                if now.duration_since(finished_at) < DONE_RETENTION {
                    None
                } else {
                    Some(id.clone())
                }
            })
            .collect();
        for id in expired {
            self.turns.remove(&id);
            self.running.remove(&id);
        }
    }
}

fn hub() -> &'static Mutex<Hub> {
    static HUB: OnceLock<Mutex<Hub>> = OnceLock::new();
    HUB.get_or_init(|| Mutex::new(Hub::new()))
}

fn with_hub<T>(action: impl FnOnce(&mut Hub) -> T) -> T {
    let mut guard = hub()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

fn approx_value_bytes(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(_) => 4,
        Value::Number(n) => n.to_string().len(),
        Value::String(s) => s.len(),
        Value::Array(items) => items
            .iter()
            .map(approx_value_bytes)
            .sum::<usize>()
            .saturating_add(2),
        Value::Object(map) => map
            .iter()
            .map(|(key, item)| key.len().saturating_add(approx_value_bytes(item)))
            .sum::<usize>()
            .saturating_add(2),
    }
}

fn truncate_string(text: &str, cap: usize) -> String {
    if text.chars().count() <= cap {
        return text.to_string();
    }
    let kept: String = text.chars().take(cap).collect();
    format!("{kept}…（已截断）")
}

fn truncate_value(value: Value, cap: usize) -> Value {
    match value {
        Value::String(text) => Value::String(truncate_string(&text, cap)),
        Value::Array(items) => {
            let mut out = Vec::new();
            let mut used = 0usize;
            for item in items {
                let next = truncate_value(item, cap);
                let size = approx_value_bytes(&next);
                if used.saturating_add(size) > cap && !out.is_empty() {
                    break;
                }
                used = used.saturating_add(size);
                out.push(next);
            }
            Value::Array(out)
        }
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, item) in map {
                out.insert(key, truncate_value(item, cap));
            }
            Value::Object(out)
        }
        other => other,
    }
}

/// 对 tool-call / tool-result 的大字段做激进截断，优先保住事件骨架。
fn scrub_tool_payloads(mut value: Value) -> Value {
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    match kind.as_str() {
        "tool-call" | "tool-approval-request" => {
            if let Some(input) = object.get_mut("input") {
                *input = truncate_value(input.take(), TOOL_PAYLOAD_CAP);
            }
        }
        "tool-result" => {
            if let Some(output) = object.get_mut("output") {
                *output = truncate_value(output.take(), TOOL_PAYLOAD_CAP);
            }
        }
        _ => {}
    }
    value
}

#[tauri::command(rename = "agentTurn:ensure")]
pub fn agentTurnEnsure(threadId: String) -> CommandResult<FollowR> {
    let id = threadId.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.prune_expired();
        let turn = hub
            .turns
            .entry(id.clone())
            .or_insert_with(TurnBuffer::fresh);
        if turn.status == TurnStatus::Done {
            *turn = TurnBuffer::fresh();
        } else {
            turn.status = TurnStatus::Running;
            turn.finished_at = None;
        }
        hub.running.insert(id);
        Ok(turn.follow_from(0))
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendP {
    pub thread_id: String,
    pub events: Vec<Value>,
}

#[tauri::command(rename = "agentTurn:append")]
pub fn agentTurnAppend(params: AppendP) -> CommandResult<u64> {
    let id = params.thread_id.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.prune_expired();
        let turn = hub
            .turns
            .entry(id.clone())
            .or_insert_with(TurnBuffer::fresh);
        if turn.status == TurnStatus::Done {
            // 已结束的回合不再写；调用方应先 ensure
            return Ok(turn.next_cursor);
        }
        for event in params.events {
            turn.push(event);
        }
        hub.running.insert(id);
        Ok(turn.next_cursor)
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowP {
    pub thread_id: String,
    pub cursor: u64,
}

#[tauri::command(rename = "agentTurn:follow")]
pub fn agentTurnFollow(params: FollowP) -> CommandResult<FollowR> {
    let id = params.thread_id.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.prune_expired();
        let Some(turn) = hub.turns.get(&id) else {
            return Ok(FollowR {
                events: Vec::new(),
                next_cursor: params.cursor,
                status: TurnStatus::Missing,
            });
        };
        Ok(turn.follow_from(params.cursor))
    })
}

#[tauri::command(rename = "agentTurn:finish")]
pub fn agentTurnFinish(threadId: String) -> CommandResult<FollowR> {
    let id = threadId.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.prune_expired();
        hub.running.remove(&id);
        let Some(turn) = hub.turns.get_mut(&id) else {
            return Ok(FollowR {
                events: Vec::new(),
                next_cursor: 0,
                status: TurnStatus::Missing,
            });
        };
        turn.status = TurnStatus::Done;
        turn.finished_at = Some(Instant::now());
        Ok(turn.follow_from(0))
    })
}

#[tauri::command(rename = "agentTurn:forget")]
pub fn agentTurnForget(threadId: String) -> CommandResult<()> {
    let id = threadId.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.running.remove(&id);
        hub.turns.remove(&id);
        Ok(())
    })
}

#[tauri::command(rename = "agentTurn:markRunning")]
pub fn agentTurnMarkRunning(threadId: String) -> CommandResult<Vec<String>> {
    let id = threadId.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.running.insert(id);
        let mut ids: Vec<String> = hub.running.iter().cloned().collect();
        ids.sort();
        Ok(ids)
    })
}

#[tauri::command(rename = "agentTurn:clearRunning")]
pub fn agentTurnClearRunning(threadId: String) -> CommandResult<Vec<String>> {
    let id = threadId.trim().to_string();
    if id.is_empty() {
        return Err(Exception::Validation("threadId 不能为空".into()));
    }
    with_hub(|hub| {
        hub.running.remove(&id);
        let mut ids: Vec<String> = hub.running.iter().cloned().collect();
        ids.sort();
        Ok(ids)
    })
}

#[tauri::command(rename = "agentTurn:listRunning")]
pub fn agentTurnListRunning() -> CommandResult<Vec<String>> {
    with_hub(|hub| {
        let mut ids: Vec<String> = hub.running.iter().cloned().collect();
        ids.sort();
        Ok(ids)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ring_drops_oldest_when_over_count() {
        with_hub(|hub| {
            hub.turns.clear();
            hub.running.clear();
        });
        agentTurnEnsure("t1".into()).unwrap();
        for index in 0..(MAX_EVENTS + 10) {
            agentTurnAppend(AppendP {
                thread_id: "t1".into(),
                events: vec![json!({ "kind": "text", "blockID": "b", "text": format!("{index}") })],
            })
            .unwrap();
        }
        let followed = agentTurnFollow(FollowP {
            thread_id: "t1".into(),
            cursor: 0,
        })
        .unwrap();
        assert!(followed.events.len() <= MAX_EVENTS);
        assert_eq!(followed.status, TurnStatus::Running);
    }

    #[test]
    fn tool_result_payload_is_truncated() {
        let huge = "x".repeat(TOOL_PAYLOAD_CAP * 4);
        let scrubbed = scrub_tool_payloads(json!({
            "kind": "tool-result",
            "toolCallId": "1",
            "toolName": "shell",
            "output": huge
        }));
        let output = scrubbed["output"].as_str().unwrap();
        assert!(output.chars().count() <= TOOL_PAYLOAD_CAP + 8);
    }

    #[test]
    fn forget_removes_done_turn() {
        with_hub(|hub| {
            hub.turns.clear();
            hub.running.clear();
        });
        agentTurnEnsure("t-forget".into()).unwrap();
        agentTurnAppend(AppendP {
            thread_id: "t-forget".into(),
            events: vec![json!({ "kind": "finish", "finishReason": "end_turn" })],
        })
        .unwrap();
        agentTurnFinish("t-forget".into()).unwrap();
        agentTurnForget("t-forget".into()).unwrap();
        let followed = agentTurnFollow(FollowP {
            thread_id: "t-forget".into(),
            cursor: 0,
        })
        .unwrap();
        assert_eq!(followed.status, TurnStatus::Missing);
    }

    #[test]
    fn prune_drops_expired_done_turns() {
        with_hub(|hub| {
            hub.turns.clear();
            hub.running.clear();
        });
        agentTurnEnsure("t-old".into()).unwrap();
        agentTurnFinish("t-old".into()).unwrap();
        with_hub(|hub| {
            if let Some(turn) = hub.turns.get_mut("t-old") {
                turn.finished_at = Some(Instant::now() - DONE_RETENTION - Duration::from_secs(1));
            }
            hub.prune_expired();
            assert!(!hub.turns.contains_key("t-old"));
        });
    }
}
