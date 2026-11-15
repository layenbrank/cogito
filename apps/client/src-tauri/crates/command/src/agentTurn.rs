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
use serde_json::{Value, json};

/// 单回合最多保留的事件条数（与 TS 过渡期 `TURN_EVENT_CAP` 对齐量级）
const MAX_EVENTS: usize = 4_000;
/// 单回合近似字节上限（序列化后粗估）
const MAX_BYTES: usize = 8 * 1024 * 1024;
/// tool-result / tool-call input 单字段上限：超过就整段换成标记对象
const TOOL_PAYLOAD_CAP: usize = 8_192;
/// 被标记掉的负载里保留多少字预览（纯文本，不保证可解析）
const PREVIEW_CHARS: usize = 2_000;
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
                // 至少留一条（终态 / 最新）：单条就超上限时只能缩它
                if let Some(front) = self.events.front_mut() {
                    front.payload = shrink_event(front.payload.clone());
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

/// 取一段**纯文本**预览：字符串直接截，其它类型先序列化再截
fn payload_preview(value: &Value) -> String {
    let text = match value {
        Value::String(raw) => raw.clone(),
        other => other.to_string(),
    };
    text.chars().take(PREVIEW_CHARS).collect()
}

/// 超过上限的负载整段换成**合法**的标记对象。
///
/// 以前是对字段做递归截断：`output` 常常是「一大段 JSON 文本」，截到 8KB 就变成非法 JSON，
/// 下游 `JSON.parse` 直接抛错；数组则是满了就 `break`，后面的项静默丢掉、计数也跟着错。
/// 现在只在最外层做一次替换 —— 结构永远合法，也明确告诉调用方「这里被截了、原始多大」。
fn shrink_payload(value: Value) -> Value {
    let bytes = approx_value_bytes(&value);
    if bytes <= TOOL_PAYLOAD_CAP {
        return value;
    }
    json!({
        "__truncated": true,
        "reason": "负载超出回合快照上限",
        "bytes": bytes,
        "preview": payload_preview(&value),
    })
}

/// 单条事件整体超出上限时的兜底：只留骨架与说明，绝不留半截内容
fn shrink_event(value: Value) -> Value {
    let next = scrub_tool_payloads(value);
    let bytes = approx_value_bytes(&next);
    if bytes <= MAX_BYTES {
        return next;
    }
    json!({
        "kind": next.get("kind").cloned().unwrap_or(Value::Null),
        "__truncated": true,
        "reason": "单条事件超出回合快照上限",
        "bytes": bytes,
    })
}

/// 对 tool-call / tool-result 的大字段做**整段**替换，优先保住事件骨架。
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
                *input = shrink_payload(input.take());
            }
        }
        "tool-result" => {
            if let Some(output) = object.get_mut("output") {
                *output = shrink_payload(output.take());
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
    fn oversized_tool_payload_becomes_a_valid_marker() {
        let huge = "x".repeat(TOOL_PAYLOAD_CAP * 4);
        let scrubbed = scrub_tool_payloads(json!({
            "kind": "tool-result",
            "toolCallId": "1",
            "toolName": "shell",
            "output": huge
        }));
        let output = &scrubbed["output"];
        // 整段换成对象：结构仍然合法，不会出现「半截 JSON 文本」
        assert_eq!(output["__truncated"], json!(true));
        assert!(output["bytes"].as_u64().unwrap() > TOOL_PAYLOAD_CAP as u64);
        assert!(output["preview"].as_str().unwrap().chars().count() <= PREVIEW_CHARS);
    }

    #[test]
    fn small_tool_payload_passes_through_untouched() {
        let scrubbed = scrub_tool_payloads(json!({
            "kind": "tool-result",
            "toolCallId": "1",
            "toolName": "read",
            "output": { "paths": ["a.ts", "b.ts"] }
        }));
        // 大负载被替换成标记，小负载必须原样保留（以前数组会被逐项裁掉）
        assert_eq!(scrubbed["output"], json!({ "paths": ["a.ts", "b.ts"] }));
    }

    #[test]
    fn oversized_array_payload_keeps_no_partial_items() {
        let items: Vec<Value> = (0..5_000)
            .map(|index| json!(format!("path-{index}")))
            .collect();
        let scrubbed = scrub_tool_payloads(json!({
            "kind": "tool-result",
            "toolCallId": "1",
            "toolName": "cogito_workspace_list",
            "output": items
        }));
        // 要么整组、要么标记对象：不允许「前 N 项 + 静默丢尾巴」
        assert_eq!(scrubbed["output"]["__truncated"], json!(true));
        assert!(scrubbed["output"].get("paths").is_none());
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
