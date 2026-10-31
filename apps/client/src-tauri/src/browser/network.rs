//! 浏览器网络记录：订阅 CDP 的 `Network.*` 事件，按 tab 聚合出请求列表。
//!
//! 这里只做**记录**，不做拦截（拦截在 `intercept.rs`）：agent 需要先能看清
//! 「页面发了什么请求、状态码、多大、多久」，才有意义去改参数重发。
//!
//! 时间单位说明：CDP 的 `timestamp` 是 `MonotonicTime`（秒，浮点），
//! 两事件相减即耗时；`encodedDataLength` 是字节数。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::AppHandle;

use super::cdp;
use super::cdp_events::{self, EventSink};

/// 每个 tab 最多留多少条：足够看清一次页面加载，又不至于吃内存
const MAX_ENTRIES: usize = 500;

/// 一条网络请求（同一 `requestId` 的多个事件合并到这一条上）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetEntry {
    pub id: String,
    pub method: String,
    pub url: String,
    /// CDP 的 `ResourceType`（Document / XHR / Fetch / Script …）
    pub kind: Option<String>,
    pub status: Option<i64>,
    pub mime: Option<String>,
    /// 响应字节数
    pub size: Option<f64>,
    pub duration_ms: Option<f64>,
    /// 单调时钟起点，仅用于算耗时，不对外
    #[serde(skip)]
    started_at: f64,
}

#[derive(Default)]
struct NetworkLog {
    entries: HashMap<String, Vec<NetEntry>>,
    /// 已订阅过的 tab，避免重复装事件接收器
    subscribed: HashSet<String>,
}

fn log() -> &'static Mutex<NetworkLog> {
    static LOG: OnceLock<Mutex<NetworkLog>> = OnceLock::new();
    LOG.get_or_init(Mutex::default)
}

fn with_log<T>(action: impl FnOnce(&mut NetworkLog) -> T) -> T {
    let mut guard = log()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// 给这个 tab 打开网络记录：**先订阅、后 `Network.enable`**。
///
/// 顺序不能反：enable 一执行事件就开始推送，订阅晚一步就会丢掉页面最早的请求。
/// 订阅失败时不标记为已订阅，下次还能重试。
pub fn install(app: &AppHandle, label: &str) {
    let already = with_log(|log| log.subscribed.contains(label));
    if already {
        return;
    }

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let mut subscribed = true;
        for event in [
            "Network.requestWillBeSent",
            "Network.responseReceived",
            "Network.loadingFinished",
        ] {
            let tab = owner.clone();
            let sink: EventSink = std::sync::Arc::new(move |payload: &str| {
                record(&tab, event, payload);
            });
            if let Err(error) = cdp_events::subscribe(&handle, &owner, event, sink) {
                log::warn!("browser: 订阅 {event} 失败（{owner}）: {error}");
                subscribed = false;
            }
        }
        if !subscribed {
            return;
        }

        // 订阅就绪后再开流，否则早期请求的事件没人接
        if let Err(error) = cdp::call(&handle, &owner, "Network.enable", json!({})).await {
            log::warn!("browser: Network.enable 失败（{owner}）: {error}");
            return;
        }
        with_log(|log| log.subscribed.insert(owner));
    });
}

/// 事件分发：把一条事件并进对应的请求条目
fn record(tab: &str, event: &str, payload: &str) {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    let Some(id) = value.get("requestId").and_then(Value::as_str) else {
        return;
    };
    let id = id.to_string();

    match event {
        "Network.requestWillBeSent" => {
            let method = value
                .get("request")
                .and_then(|request| request.get("method"))
                .and_then(Value::as_str)
                .unwrap_or("GET")
                .to_string();
            let url = value
                .get("request")
                .and_then(|request| request.get("url"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let kind = value
                .get("type")
                .and_then(Value::as_str)
                .map(str::to_string);
            let started_at = value
                .get("timestamp")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);

            with_log(|log| {
                let bucket = log.entries.entry(tab.to_string()).or_default();
                // 重定向会复用 requestId，直接就地更新
                if let Some(existing) = bucket.iter_mut().find(|entry| entry.id == id) {
                    existing.method = method;
                    existing.url = url;
                    existing.kind = kind;
                    existing.started_at = started_at;
                    return;
                }
                if bucket.len() >= MAX_ENTRIES {
                    bucket.remove(0);
                }
                bucket.push(NetEntry {
                    id,
                    method,
                    url,
                    kind,
                    status: None,
                    mime: None,
                    size: None,
                    duration_ms: None,
                    started_at,
                });
            });
        }
        "Network.responseReceived" => {
            let response = value.get("response");
            let status = response
                .and_then(|response| response.get("status"))
                .and_then(Value::as_i64);
            let mime = response
                .and_then(|response| response.get("mimeType"))
                .and_then(Value::as_str)
                .map(str::to_string);
            patch(tab, &id, |entry| {
                entry.status = status;
                entry.mime = mime;
            });
        }
        "Network.loadingFinished" => {
            let size = value.get("encodedDataLength").and_then(Value::as_f64);
            let finished_at = value.get("timestamp").and_then(Value::as_f64);
            patch(tab, &id, |entry| {
                entry.size = size;
                if let (Some(finished), start) = (finished_at, entry.started_at) {
                    if start > 0.0 && finished >= start {
                        entry.duration_ms = Some((finished - start) * 1000.0);
                    }
                }
            });
        }
        _ => {}
    }
}

fn patch(tab: &str, id: &str, action: impl FnOnce(&mut NetEntry)) {
    with_log(|log| {
        let Some(bucket) = log.entries.get_mut(tab) else {
            return;
        };
        if let Some(entry) = bucket.iter_mut().find(|entry| entry.id == id) {
            action(entry);
        }
    });
}

/// 查询：`filter` 是 URL 子串匹配，返回最新的在前
#[must_use]
pub fn list(tab: &str, filter: Option<&str>, limit: usize) -> Vec<NetEntry> {
    with_log(|log| {
        let Some(bucket) = log.entries.get(tab) else {
            return Vec::new();
        };
        bucket
            .iter()
            .rev()
            .filter(|entry| match filter {
                Some(needle) if !needle.is_empty() => entry.url.contains(needle),
                _ => true,
            })
            .take(limit)
            .cloned()
            .collect()
    })
}

/// 清空某个 tab 的记录（webview 关闭时调用，避免 label 复用后串数据）
pub fn forget(tab: &str) {
    with_log(|log| {
        log.entries.remove(tab);
        log.subscribed.remove(tab);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str, url: &str, started_at: f64) -> String {
        json!({
            "requestId": id,
            "timestamp": started_at,
            "type": "XHR",
            "request": { "method": "POST", "url": url }
        })
        .to_string()
    }

    #[test]
    fn merges_events_into_one_entry() {
        let tab = "unit-test-merge";
        forget(tab);

        record(tab, "Network.requestWillBeSent", &request("r1", "https://a.test/x", 10.0));
        record(
            tab,
            "Network.responseReceived",
            &json!({
                "requestId": "r1",
                "response": { "status": 200, "mimeType": "application/json" }
            })
            .to_string(),
        );
        record(
            tab,
            "Network.loadingFinished",
            &json!({ "requestId": "r1", "timestamp": 10.25, "encodedDataLength": 2048.0 })
                .to_string(),
        );

        let entries = list(tab, None, 10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].status, Some(200));
        assert_eq!(entries[0].mime.as_deref(), Some("application/json"));
        assert_eq!(entries[0].size, Some(2048.0));
        assert!((entries[0].duration_ms.unwrap_or_default() - 250.0).abs() < 1.0);
        forget(tab);
    }

    #[test]
    fn filters_and_orders_newest_first() {
        let tab = "unit-test-order";
        forget(tab);

        record(tab, "Network.requestWillBeSent", &request("a", "https://a.test/one", 1.0));
        record(tab, "Network.requestWillBeSent", &request("b", "https://b.test/two", 2.0));

        let all = list(tab, None, 10);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "b", "最新的应该排在最前");

        let filtered = list(tab, Some("a.test"), 10);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "a");
        forget(tab);
    }

    #[test]
    fn evicts_oldest_when_bucket_is_full() {
        let tab = "unit-test-evict";
        forget(tab);
        for index in 0..(MAX_ENTRIES + 5) {
            record(
                tab,
                "Network.requestWillBeSent",
                &request(&format!("id-{index}"), "https://a.test", index as f64),
            );
        }
        let entries = list(tab, None, MAX_ENTRIES + 10);
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].id, format!("id-{}", MAX_ENTRIES + 4));
        forget(tab);
    }
}
