//! 分层路由（S11）：本地优先 → 云兜底。
//!
//! 这一层只做**判定**，不自己发请求：真正调模型的是 goose。把判定单独抽出来，
//! 是为了让「什么时候降级」成为一条可测的规则，而不是散落在各处的
//! `if provider.kind == "ollama" { ... }`。
//!
//! 三条硬规则：
//! ① **默认本地**：会话档位 `local` 时优先本地 provider；只有本地确实不可用才走云。
//! ② **只在可判定失败时降级**：连接被拒 / 模型不存在属可判定（换条路确实能好）；
//!    超时、鉴权失败、用户取消都不降级 —— 用户取消后切云会「帮他重新跑一遍」，
//!    这是他明确不要的行为。
//! ③ **云是尽头**：云再失败没有下一层，返回 `None`，由调用方如实报错。
//!
//! 档位落在 `agent_session.routeTier`（S9 已经建好这一列，默认 `local`）。

use serde::{Deserialize, Serialize};

/// 本地档位：本机模型（Ollama / 本机自托管）。
pub const TIER_LOCAL: &str = "local";
/// 云档位：云端 / 网关模型。
pub const TIER_CLOUD: &str = "cloud";

/// 路由档位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Local,
    Cloud,
}

impl Tier {
    /// 解析档位字符串。非法值报错而不是回落 —— 静默回落会把用户的选择抹掉。
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            TIER_LOCAL => Ok(Self::Local),
            TIER_CLOUD => Ok(Self::Cloud),
            other => Err(format!("未知路由档位：{other}（只认 local / cloud）")),
        }
    }

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => TIER_LOCAL,
            Self::Cloud => TIER_CLOUD,
        }
    }

    /// 下一层兜底。云已经是尽头。
    #[must_use]
    pub fn other(self) -> Option<Self> {
        match self {
            Self::Local => Some(Self::Cloud),
            Self::Cloud => None,
        }
    }
}

/// 失败归类。只有 `Decidable` 的那两种才允许降级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Failure {
    /// 连不上本地服务（连接被拒 / 端口没起）—— 换云能好
    ConnectRefused,
    /// 本地没有这个模型（没 pull / 名字错）—— 换云能好
    ModelMissing,
    /// 鉴权失败：换条路不会好，是配置问题
    Unauthorized,
    /// 超时：可能是模型在慢慢算，也可能是网络抖动 —— 不降级（降级会把慢当成坏）
    Timeout,
    /// 用户主动取消：**绝不**降级
    UserCancel,
    /// 认不出来的失败：不降级（宁可报错，也不替用户换模型）
    Unknown,
}

impl Failure {
    /// 按错误文案归类。
    ///
    /// 文案来自 goose / 各家 SDK，做不到穷举；这里只认几条稳定的形态，
    /// 认不出来就算 `Unknown`（→ 不降级）。顺序有意义：取消最先判，
    /// 免得「cancelled after connection refused」这类拼接文案被误判成可降级。
    #[must_use]
    pub fn classify(message: &str) -> Self {
        let text = message.to_ascii_lowercase();
        if text.contains("cancel") || message.contains("取消") || text.contains("abor") {
            return Self::UserCancel;
        }
        if text.contains("model not found")
            || text.contains("no such model")
            || text.contains("model_not_found")
            || message.contains("模型不存在")
        {
            return Self::ModelMissing;
        }
        if text.contains("econnrefused")
            || text.contains("connection refused")
            || text.contains("failed to connect")
            || text.contains("connect error")
            || text.contains("os error 10061")
            || text.contains("dial tcp")
            || message.contains("连接被拒")
            || message.contains("拒绝连接")
        {
            return Self::ConnectRefused;
        }
        if text.contains("401")
            || text.contains("403")
            || text.contains("unauthorized")
            || text.contains("invalid api key")
            || text.contains("authentication")
            || message.contains("鉴权")
            || message.contains("密钥")
        {
            return Self::Unauthorized;
        }
        if text.contains("timed out") || text.contains("timeout") || text.contains("etimedout") {
            return Self::Timeout;
        }
        Self::Unknown
    }

    /// 换条路确实可能好：只有这两种。
    #[must_use]
    pub fn is_decidable(self) -> bool {
        matches!(self, Self::ConnectRefused | Self::ModelMissing)
    }
}

/// 一次路由判定。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlan {
    /// 本轮该走的档位
    pub tier: Tier,
    /// 这一档失败后能退到哪（`None` = 已经是尽头）
    pub fallback: Option<Tier>,
    /// 是否因为「本档不可用」而退到了下一档
    pub degraded: bool,
    /// 给人看的一句话；`degraded` 为真时写清为什么
    pub reason: String,
}

/// 规划本轮路由。
///
/// `local_ready` 由调用方探测（本地 provider 是否存在 / Ollama `/api/tags` 有没有模型），
/// 这里只管判定 —— 探测的失败方式千奇百怪，判定逻辑必须只有一份。
#[must_use]
pub fn plan(preferred: Tier, local_ready: bool, local_detail: &str) -> RoutePlan {
    match preferred {
        Tier::Cloud => RoutePlan {
            tier: Tier::Cloud,
            fallback: None,
            degraded: false,
            reason: "档位为云：不再向上兜底".to_string(),
        },
        Tier::Local if local_ready => RoutePlan {
            tier: Tier::Local,
            fallback: Tier::Local.other(),
            degraded: false,
            reason: "本地模型可用".to_string(),
        },
        Tier::Local => {
            let detail = local_detail.trim();
            let reason = if detail.is_empty() {
                "本地模型不可用，本轮走云兜底".to_string()
            } else {
                format!("本地模型不可用（{detail}），本轮走云兜底")
            };
            RoutePlan {
                tier: Tier::Cloud,
                fallback: None,
                degraded: true,
                reason,
            }
        }
    }
}

/// 失败之后该换到哪。`None` = 不换（原地报错）。
#[must_use]
pub fn degrade(from: Tier, failure: Failure) -> Option<Tier> {
    if !failure.is_decidable() {
        return None;
    }
    from.other()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_parses_only_known_values() {
        assert_eq!(Tier::parse(" local ").expect("local"), Tier::Local);
        assert_eq!(Tier::parse("CLOUD").expect("cloud"), Tier::Cloud);
        assert!(Tier::parse("edge").is_err());
        assert_eq!(Tier::Local.as_str(), TIER_LOCAL);
        assert_eq!(Tier::Cloud.other(), None);
    }

    #[test]
    fn local_ready_stays_local_with_cloud_as_backstop() {
        let plan = plan(Tier::Local, true, "");
        assert_eq!(plan.tier, Tier::Local);
        assert_eq!(plan.fallback, Some(Tier::Cloud));
        assert!(!plan.degraded);
    }

    #[test]
    fn local_missing_degrades_to_cloud_with_reason() {
        let plan = plan(Tier::Local, false, "Ollama 未运行");
        assert_eq!(plan.tier, Tier::Cloud);
        assert!(plan.degraded);
        assert!(plan.reason.contains("Ollama 未运行"), "{}", plan.reason);
        assert_eq!(plan.fallback, None);
    }

    #[test]
    fn cloud_tier_never_degrades_further() {
        let plan = plan(Tier::Cloud, false, "");
        assert_eq!(plan.tier, Tier::Cloud);
        assert!(!plan.degraded);
        assert_eq!(plan.fallback, None);
    }

    #[test]
    fn classify_separates_decidable_from_ambiguous() {
        assert_eq!(
            Failure::classify("connect error: Connection refused (os error 10061)"),
            Failure::ConnectRefused
        );
        assert_eq!(
            Failure::classify("ollama: model not found: qwen3:14b"),
            Failure::ModelMissing
        );
        assert_eq!(Failure::classify("request timed out"), Failure::Timeout);
        assert_eq!(
            Failure::classify("401 Unauthorized: invalid api key"),
            Failure::Unauthorized
        );
        assert_eq!(Failure::classify("操作已取消"), Failure::UserCancel);
        assert_eq!(Failure::classify("something odd"), Failure::Unknown);
    }

    #[test]
    fn user_cancel_is_checked_before_decidable_keywords() {
        // 拼接文案：先取消了，后面还跟着连接错误 —— 仍然是「用户取消」
        let failure = Failure::classify("cancelled: connection refused");
        assert_eq!(failure, Failure::UserCancel);
        assert_eq!(degrade(Tier::Local, failure), None);
    }

    #[test]
    fn degrade_only_on_decidable_failures_from_local() {
        assert_eq!(
            degrade(Tier::Local, Failure::ConnectRefused),
            Some(Tier::Cloud)
        );
        assert_eq!(
            degrade(Tier::Local, Failure::ModelMissing),
            Some(Tier::Cloud)
        );
        assert_eq!(degrade(Tier::Local, Failure::Timeout), None);
        assert_eq!(degrade(Tier::Local, Failure::Unauthorized), None);
        assert_eq!(degrade(Tier::Local, Failure::Unknown), None);
        // 云是尽头：可判定失败也不换
        assert_eq!(degrade(Tier::Cloud, Failure::ConnectRefused), None);
    }
}
