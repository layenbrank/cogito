//! 请求拦截：给 agent 一个「拦住某个 URL → 掐断 / 换成固定响应」的开关。
//!
//! 走 CDP `Fetch` 域而不是 WebView2 的 `WebResourceRequested`：后者一旦注册，
//! 所有匹配请求都会停下来等 handler 填响应，漏一个就是白屏；`Fetch` 有
//! `continueRequest` / `failRequest` / `fulfillRequest` 三个明确出口，
//! 而且还能顺带改状态码和 body。
//!
//! 代价：`Fetch.enable` 会暂停**每一个**请求，每次都要一次 CDP 往返。
//! 所以没有规则时一律 `Fetch.disable` —— 记录网络（`network.rs`）不需要它。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;

use super::cdp;
use super::cdp_events::{self, EventSink};

const EVENT_PAUSED: &str = "Fetch.requestPaused";
const DEFAULT_STATUS: i64 = 200;
const DEFAULT_MIME: &str = "application/json";

/// `Fetch.enable` 的入参。
///
/// **必须显式给 patterns**：CDP 里省略 `patterns` 时默认才是
/// `[{urlPattern:"*", requestStage:"Request"}]`，而显式传**空数组**等于「零个拦截模式」——
/// 于是 `Fetch.requestPaused` 永远不会触发，block / mock / edit 三条分支全成死代码
/// （现场表现：dev server 页面的 XHR 照发，拿到真实 401）。这个函数被单测锁住。
fn enable_params() -> Value {
    json!({
        "patterns": [{ "urlPattern": "*", "requestStage": "Request" }]
    })
}

/// 一个 tab 上的拦截计数（自 `Fetch.enable` 起累计，`Fetch.disable` 清零）。
///
/// 存在意义是**把两种故障分开**：`paused` 恒为 0 说明 `Fetch.requestPaused` 根本没到
/// （enable 参数或事件订阅有问题）；`paused > 0` 而 `matched` 恒为 0 说明事件到了但规则没命中
/// （pattern 写错）。没有这两个数只能靠猜。
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptCounters {
    /// 收到 `Fetch.requestPaused` 的次数
    pub paused: u64,
    /// 命中规则（真的改了响应 / 掐断了请求）的次数
    pub matched: u64,
}

/// `set_rules` 的返回值：生效条数 + 当前计数（面板与工具面都要看得到「真的拦到了没有」）。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptStatus {
    pub rules: usize,
    pub paused: u64,
    pub matched: u64,
}

/// 一条请求头（`Fetch.continueRequest` 的覆盖入参）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}

/// 一条拦截规则。`pattern` 是 URL 子串匹配（够用且不需要用户写正则）。
///
/// 三种动作：
/// - `block`：直接掉断；
/// - `mock`：用固定响应替换；
/// - `edit`：改地址 / 改请求头 / 改请求体后再放行（“改参重发”）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub pattern: String,
    /// `block` / `mock` / `edit`
    pub action: String,
    /// mock 用的状态码，默认 200
    #[serde(default)]
    pub status: Option<i64>,
    /// mock 用的响应体（原文，内部转 base64）
    #[serde(default)]
    pub body: Option<String>,
    /// mock 用的 Content-Type，默认 application/json
    #[serde(default)]
    pub mime: Option<String>,
    /// edit：把请求改到这个地址（原地址以 pattern 为子串）
    #[serde(default)]
    pub url: Option<String>,
    /// edit：覆盖/追加请求头
    #[serde(default)]
    pub headers: Option<Vec<Header>>,
    /// edit：替换请求体（原文，内部转 base64）
    #[serde(default)]
    pub post_data: Option<String>,
}

impl Rule {
    fn is_valid(&self) -> bool {
        !self.pattern.trim().is_empty()
            && matches!(self.action.as_str(), "block" | "mock" | "edit")
    }
}

#[derive(Default)]
struct Intercepts {
    rules: HashMap<String, Vec<Rule>>,
    subscribed: HashSet<String>,
    /// 每个 tab 的 paused / matched 计数
    counters: HashMap<String, InterceptCounters>,
}

fn state() -> &'static Mutex<Intercepts> {
    static STATE: OnceLock<Mutex<Intercepts>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

fn with_state<T>(action: impl FnOnce(&mut Intercepts) -> T) -> T {
    let mut guard = state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// 当前这个 tab 的规则快照（用于把 UI 状态对齐）
#[must_use]
pub fn rules(label: &str) -> Vec<Rule> {
    with_state(|state| state.rules.get(label).cloned().unwrap_or_default())
}

/// 当前计数器快照（没有记录就是全 0）。
#[must_use]
pub fn counters(label: &str) -> InterceptCounters {
    with_state(|state| state.counters.get(label).copied().unwrap_or_default())
}

/// 记一次 `Fetch.requestPaused`；`matched` 表示这次命中规则并改写了请求。
fn note_paused(label: &str, matched: bool) {
    with_state(|state| {
        let entry = state.counters.entry(label.to_string()).or_default();
        entry.paused = entry.paused.saturating_add(1);
        if matched {
            entry.matched = entry.matched.saturating_add(1);
        }
    });
}

/// 取出**命中的那一条**。
///
/// 这是每个请求都要走的热路径，所以克隆只限于命中规则；拦截关闭时锁持有时间几乎为零。
fn match_rule(label: &str, url: &str) -> Option<Rule> {
    with_state(|state| {
        state
            .rules
            .get(label)?
            .iter()
            .find(|rule| url.contains(rule.pattern.trim()))
            .cloned()
    })
}

/// 设置规则：空数组 = 关闭拦截并 `Fetch.disable`。返回生效的规则数。
///
/// 顺序是「订阅 → 存规则 → enable」：
/// - 订阅必须**先**完成（`subscribe` 会等到装好才返回），否则 enable 之后的第一个
///   请求会挂起却没人 `continue`，页面直接卡死；
/// - 订阅失败就整体失败，不能把规则留在内存里假装生效。
pub async fn set_rules(
    app: &AppHandle,
    label: &str,
    rules: Vec<Rule>,
) -> Result<InterceptStatus, String> {
    let accepted: Vec<Rule> = rules.into_iter().filter(Rule::is_valid).collect();

    if accepted.is_empty() {
        with_state(|state| {
            state.rules.remove(label);
            state.counters.remove(label);
        });
        // 关掉之前必须先确保没有残留的 enable 状态，否则所有请求都会挂起
        if let Err(error) = cdp::call(app, label, "Fetch.disable", json!({})).await {
            log::warn!("browser: Fetch.disable 失败（{label}）: {error}");
        }
        return Ok(InterceptStatus {
            rules: 0,
            paused: 0,
            matched: 0,
        });
    }

    let needs_subscribe = with_state(|state| !state.subscribed.contains(label));
    if needs_subscribe {
        install_subscription(app, label)?;
        with_state(|state| state.subscribed.insert(label.to_string()));
    }

    let count = accepted.len();
    with_state(|state| state.rules.insert(label.to_string(), accepted));

    cdp::call(app, label, "Fetch.enable", enable_params())
        .await
        .map_err(|error| format!("开启拦截失败：{error}"))?;
    // 计数是「拦截通道真的活着」的唯一证据：空 patterns 时代它恒为 0
    let snapshot = counters(label);
    log::info!(
        "browser: 拦截已开启（{label}，{count} 条规则，paused={} matched={}）",
        snapshot.paused,
        snapshot.matched
    );
    Ok(InterceptStatus {
        rules: count,
        paused: snapshot.paused,
        matched: snapshot.matched,
    })
}

/// 订阅 `Fetch.requestPaused`（每个 tab 一次）
fn install_subscription(app: &AppHandle, label: &str) -> Result<(), String> {
    let handle = app.clone();
    let owner = label.to_string();
    let sink: EventSink = std::sync::Arc::new(move |payload: &str| {
        handle_paused(&handle, &owner, payload);
    });
    cdp_events::subscribe(app, label, EVENT_PAUSED, sink)
}

/// 事件回调里**不能** await（它在主线程），所以立刻 spawn 出去
fn handle_paused(app: &AppHandle, label: &str, payload: &str) {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    let Some(request_id) = value
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    let url = value
        .get("request")
        .and_then(|request| request.get("url"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let hit = match_rule(label, &url);
    // 计数在订阅回调里立刻记：这是「requestPaused 到底来没来」的实测证据
    note_paused(label, hit.is_some());

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let (method, params) = match hit {
            Some(rule) if rule.action == "block" => (
                "Fetch.failRequest",
                json!({ "requestId": request_id, "errorReason": "BlockedByClient" }),
            ),
            Some(rule) if rule.action == "edit" => {
                // 只覆盖规则里真正给了的字段：没给的留给原请求
                let mut params = serde_json::Map::new();
                params.insert("requestId".into(), json!(request_id));
                if let Some(url) = rule.url.filter(|url| !url.is_empty()) {
                    params.insert("url".into(), json!(url));
                }
                if let Some(headers) = rule.headers {
                    params.insert("headers".into(), json!(headers));
                }
                if let Some(body) = rule.post_data {
                    params.insert(
                        "postData".into(),
                        json!(base64_encode(body.as_bytes())),
                    );
                }
                ("Fetch.continueRequest", Value::Object(params))
            }
            Some(rule) => {
                let body = rule.body.unwrap_or_default();
                (
                    "Fetch.fulfillRequest",
                    json!({
                        "requestId": request_id,
                        "responseCode": rule.status.unwrap_or(DEFAULT_STATUS),
                        "responseHeaders": [
                            { "name": "content-type", "value": rule.mime.unwrap_or_else(|| DEFAULT_MIME.to_string()) }
                        ],
                        "body": base64_encode(body.as_bytes())
                    }),
                )
            }
            None => (
                "Fetch.continueRequest",
                json!({ "requestId": request_id }),
            ),
        };

        if let Err(error) = cdp::call(&handle, &owner, method, params).await {
            log::warn!("browser: {method} 失败（{owner}）: {error}");
            // 兜底：CDP 调用失败时请求会永久挂起，必须再试一次放行
            if method != "Fetch.continueRequest" {
                if let Err(again) = cdp::call(
                    &handle,
                    &owner,
                    "Fetch.continueRequest",
                    json!({ "requestId": request_id }),
                )
                .await
                {
                    log::warn!("browser: 兜底放行也失败（{owner}）: {again}");
                }
            }
        }
    });
}

/// 清空某个 tab 的规则（webview 关闭时）
pub fn forget(label: &str) {
    with_state(|state| {
        state.rules.remove(label);
        state.subscribed.remove(label);
        state.counters.remove(label);
    });
}

/// 标准 base64：`Fetch.fulfillRequest` 的 body 必须是 base64
pub(crate) fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(triple >> 18) as usize & 0x3f] as char);
        out.push(TABLE[(triple >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple as usize & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(
            base64_encode("{\"ok\":true}".as_bytes()),
            "eyJvayI6dHJ1ZX0="
        );
    }

    #[test]
    fn enable_params_asks_for_a_real_pattern() {
        // 空 patterns = 零个拦截模式：requestPaused 永远不会来，mock/block 全是死代码
        let params = enable_params();
        let patterns = params
            .get("patterns")
            .and_then(Value::as_array)
            .expect("Fetch.enable 必须显式带 patterns");
        assert!(!patterns.is_empty(), "patterns 不能是空数组");
        assert_eq!(
            patterns[0].get("urlPattern").and_then(Value::as_str),
            Some("*")
        );
        assert_eq!(
            patterns[0].get("requestStage").and_then(Value::as_str),
            Some("Request")
        );
    }

    #[test]
    fn counters_accumulate_and_reset_per_tab() {
        let label = "test-tab-counters";
        note_paused(label, false);
        note_paused(label, true);
        let snapshot = counters(label);
        assert_eq!(snapshot.paused, 2);
        assert_eq!(snapshot.matched, 1);
        assert_eq!(counters("test-tab-absent").paused, 0, "没记录的 tab 应为 0");
        forget(label);
        assert_eq!(counters(label).paused, 0, "forget 要连计数一起清掉");
    }

    #[test]
    fn rejects_invalid_rules() {
        assert!(
            !Rule {
                pattern: "  ".into(),
                action: "block".into(),
                ..Default::default()
            }
            .is_valid()
        );
        assert!(
            !Rule {
                pattern: "a".into(),
                action: "nope".into(),
                ..Default::default()
            }
            .is_valid()
        );
        assert!(
            Rule {
                pattern: "api.test".into(),
                action: "mock".into(),
                status: Some(500),
                body: Some("{}".into()),
                ..Default::default()
            }
            .is_valid()
        );
        assert!(
            Rule {
                pattern: "api.test".into(),
                action: "edit".into(),
                url: Some("https://api.test/v2".into()),
                ..Default::default()
            }
            .is_valid()
        );
    }
}
