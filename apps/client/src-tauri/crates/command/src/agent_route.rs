#![allow(non_snake_case)]

//! 分层路由的 IPC 面（S11）。
//!
//! 两个问题、三个命令：
//! - 「这轮该走哪条路」→ `agentRoute:plan`（会探一次本机 Ollama，1.5s 超时）
//! - 「刚这一轮失败了，要不要换路」→ `agentRoute:degrade`（纯判定，不发请求）
//! - 「用户手选了哪一档」→ `agentRoute:setTier`（落 `agent_session.routeTier`）
//!
//! 探测和判定分开：判定在 `cogito_core::agent_route` 里，前端与非前端共用同一套规则；
//! 这里只负责「本机到底有没有本地模型」这一件脏活。

use std::time::Duration;

use cogito_core::agent_route::{self, Failure, RoutePlan, Tier};
use cogito_core::agent_session::Service;
use cogito_core::{CommandResult, Exception};
use cogito_database::Storage;
use serde::{Deserialize, Serialize};
use tauri::State;

/// 本机 Ollama 的模型清单接口（`/api/tags` 是只读的，不会加载模型）。
const OLLAMA_TAGS: &str = "http://localhost:11434/api/tags";
/// 探测上限：连不上要**很快**失败，否则每次发消息都先卡 1.5 秒。
const PROBE_TIMEOUT_MS: u64 = 1500;

/// 本地探测结论。
#[derive(Debug, Clone, PartialEq, Eq)]
enum Probe {
    /// 本地服务在，模型清单拿到了
    Ready(Vec<String>),
    /// 本地缺这个模型（服务在）—— 可判定，换云能好
    Missing(String),
    /// 本地服务没起 / 报错 —— 可判定，换云能好
    Down(String),
    /// 认不出来（超时等）—— **不**当成本地不可用，避免把「慢」判成「坏」
    Unknown(String),
}

impl Probe {
    fn detail(&self) -> String {
        match self {
            Self::Ready(_) => String::new(),
            Self::Missing(detail) | Self::Down(detail) | Self::Unknown(detail) => detail.clone(),
        }
    }

    /// 只有 `Ready` / `Unknown` 算「本地可用」：`Unknown` 按可用处理是刻意的 ——
    /// 探测失败不等于模型不可用，降级的代价（悄悄换云、数据出本机）比多试一次大得多。
    fn local_ready(&self) -> bool {
        matches!(self, Self::Ready(_) | Self::Unknown(_))
    }

    fn models(&self) -> Vec<String> {
        match self {
            Self::Ready(models) => models.clone(),
            _ => Vec::new(),
        }
    }
}

/// 探一次本机 Ollama。只读，不加载模型，不改任何状态。
async fn probe_local(model: Option<&str>) -> Probe {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(PROBE_TIMEOUT_MS))
        .build()
    {
        Ok(client) => client,
        Err(error) => return Probe::Unknown(format!("探测客户端构造失败：{error}")),
    };
    let response = match client.get(OLLAMA_TAGS).send().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return Probe::Unknown(format!("探测超时（{PROBE_TIMEOUT_MS}ms）"));
        }
        Err(error) => return Probe::Down(format!("Ollama 未运行：{error}")),
    };
    if !response.status().is_success() {
        return Probe::Down(format!("Ollama 返回 HTTP {}", response.status()));
    }
    let text = match response.text().await {
        Ok(text) => text,
        Err(error) => return Probe::Unknown(format!("读 Ollama 响应失败：{error}")),
    };
    let body: serde_json::Value = match serde_json::from_str(&text) {
        Ok(body) => body,
        Err(error) => return Probe::Unknown(format!("Ollama 响应不是 JSON：{error}")),
    };
    let models: Vec<String> = body
        .get("models")
        .and_then(serde_json::Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row.get("name").and_then(serde_json::Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if models.is_empty() {
        return Probe::Down("Ollama 里没有任何模型".to_string());
    }
    if let Some(wanted) = model.map(str::trim).filter(|value| !value.is_empty()) {
        // Ollama 的清单带 tag（`qwen3:14b`），用户可能只写了模型名
        let found = models
            .iter()
            .any(|name| name == wanted || name.split(':').next() == Some(wanted));
        if !found {
            return Probe::Missing(format!("本地没有模型 {wanted}"));
        }
    }
    Probe::Ready(models)
}

/// `agentRoute:plan` 的入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanP {
    /// 会话档位；缺省按 `local`（分层路由的默认）
    #[serde(default)]
    pub tier: Option<String>,
    /// 本轮要用的模型名，用来判断本地到底有没有它
    #[serde(default)]
    pub model: Option<String>,
}

/// `agentRoute:plan` 的返回：判定 + 探测细节（诊断页要能说清「为什么降级了」）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanReply {
    pub plan: RoutePlan,
    /// 本机能用的本地模型（`Ready` 之外一律空）
    pub local_models: Vec<String>,
    /// 探测结论的人话（`Ready` 时为空）
    pub probe: String,
}

/// 规划本轮路由。
#[tauri::command(rename = "agentRoute:plan")]
pub async fn agentRoutePlan(params: PlanP) -> CommandResult<PlanReply> {
    let preferred = match params.tier.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Tier::parse(raw).map_err(Exception::Validation)?,
        _ => Tier::Local,
    };
    let probe = probe_local(params.model.as_deref()).await;
    let plan = agent_route::plan(preferred, probe.local_ready(), &probe.detail());
    Ok(PlanReply {
        plan,
        local_models: probe.models(),
        probe: probe.detail(),
    })
}

/// `agentRoute:degrade` 的入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DegradeP {
    /// 失败时用的档位
    pub from: String,
    /// 原始错误文案：归类只看它
    pub message: String,
}

/// `agentRoute:degrade` 的返回：判定 + 归类（`next` 为 `null` 就是「不换」）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DegradeReply {
    pub next: Option<Tier>,
    pub failure: Failure,
}

/// 失败后该不该换路。纯判定：不产生任何副作用。
#[tauri::command(rename = "agentRoute:degrade")]
pub fn agentRouteDegrade(params: DegradeP) -> CommandResult<DegradeReply> {
    let from = Tier::parse(&params.from).map_err(Exception::Validation)?;
    let failure = Failure::classify(&params.message);
    Ok(DegradeReply {
        next: agent_route::degrade(from, failure),
        failure,
    })
}

/// `agentRoute:setTier` 的入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTierP {
    pub session_id: String,
    /// `local` / `cloud`
    pub tier: String,
}

/// 把档位写进会话行（下次启动还认）。
#[tauri::command(rename = "agentRoute:setTier")]
pub async fn agentRouteSetTier(
    state: State<'_, Storage>,
    params: SetTierP,
) -> CommandResult<String> {
    Service::set_route_tier(state.connection(), &params.session_id, &params.tier).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_model_is_decidable_but_timeout_is_not() {
        assert!(!Probe::Missing("本地没有模型 qwen3".to_string()).local_ready());
        assert!(!Probe::Down("Ollama 未运行".to_string()).local_ready());
        // 探测失败 ≠ 模型不可用：超时仍按本地可用处理（不降级）
        assert!(Probe::Unknown("探测超时".to_string()).local_ready());
        assert!(Probe::Ready(vec!["qwen3:14b".to_string()]).local_ready());
    }

    #[test]
    fn plan_reply_degrades_only_when_probe_says_down() {
        let down = Probe::Down("Ollama 未运行".to_string());
        let plan = agent_route::plan(Tier::Local, down.local_ready(), &down.detail());
        assert_eq!(plan.tier, Tier::Cloud);
        assert!(plan.degraded);

        let unknown = Probe::Unknown("探测超时".to_string());
        let plan = agent_route::plan(Tier::Local, unknown.local_ready(), &unknown.detail());
        assert_eq!(plan.tier, Tier::Local, "探测失败不降级");
    }
}
