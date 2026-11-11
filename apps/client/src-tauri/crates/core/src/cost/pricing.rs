//! 模型价目表（S8）。
//!
//! 两个硬原则：
//!
//! 1. **未知模型不猜价**：`price()` 返回 `None`，账本落 `NULL`，UI 显示「未计价」。
//!    猜一个均价写进账本，比没有账本更糟 —— 用户会拿它当账单。
//! 2. **整数微元**：金额用 `i64` 存「微元」（1 元 = 1_000_000 微元），
//!    每 100 万 token 的单价也按微元记，全程整数乘除，不碰浮点。
//!
//! 价目表是**内置快照**，不是实时价：写明 `AS_OF`，用户不认可时改这一张表即可。
//! 本地推理（Ollama / LM Studio 这类）按 0 计 —— 电费不算在 API 账单里。

/// 价目表快照日期。改价格时一并改它，账本里看到的数才有可追溯的口径。
pub const AS_OF: &str = "2026-11-10";

/// 账本统一币种：人民币。美元价按 7.2 折算后写进表里。
pub const CURRENCY: &str = "CNY";

/// 一次计价的结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Price {
    /// 微元（1 元 = 1_000_000）
    pub price_micros: i64,
    pub currency: &'static str,
}

/// 单条价目：按**模型名前缀**匹配，每 100 万 token 的微元价。
struct Rate {
    pattern: &'static str,
    input_per_million: i64,
    output_per_million: i64,
}

/// 内置价目（微元 / 100 万 token）。顺序无关：取最长匹配前缀，`gpt-4o-mini`
/// 不会被 `gpt-4o` 抢走。
const RATES: &[Rate] = &[
    Rate {
        pattern: "deepseek-chat",
        input_per_million: 2_000_000,
        output_per_million: 8_000_000,
    },
    Rate {
        pattern: "deepseek-reasoner",
        input_per_million: 4_000_000,
        output_per_million: 16_000_000,
    },
    Rate {
        pattern: "gpt-4o-mini",
        input_per_million: 1_100_000,
        output_per_million: 4_300_000,
    },
    Rate {
        pattern: "gpt-4o",
        input_per_million: 18_000_000,
        output_per_million: 72_000_000,
    },
    Rate {
        pattern: "claude-sonnet",
        input_per_million: 21_600_000,
        output_per_million: 108_000_000,
    },
    Rate {
        pattern: "claude-opus",
        input_per_million: 108_000_000,
        output_per_million: 540_000_000,
    },
    Rate {
        pattern: "qwen3-coder",
        input_per_million: 4_000_000,
        output_per_million: 16_000_000,
    },
    Rate {
        pattern: "qwen-max",
        input_per_million: 20_000_000,
        output_per_million: 60_000_000,
    },
    Rate {
        pattern: "kimi-k2",
        input_per_million: 4_000_000,
        output_per_million: 16_000_000,
    },
    Rate {
        pattern: "glm-4",
        input_per_million: 2_000_000,
        output_per_million: 8_000_000,
    },
];

/// 本地推理的前缀：这些模型没有 API 账单，按 0 记（有价目表条目也不会被误用）。
const LOCAL_PREFIXES: &[&str] = &["ollama/", "ollama:", "lmstudio/", "local/", "gguf/"];

/// 计价：未知模型返回 `None`（→ 账本 `NULL` → UI「未计价」）。
///
/// 负数 token 按 0 处理（脏数据不该倒扣钱）；极端大的 token 数用饱和乘法，
/// 不会溢出成负数。
#[must_use]
pub fn price(model: &str, input_tokens: i64, output_tokens: i64) -> Option<Price> {
    let normalized = model.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if LOCAL_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        return Some(Price {
            price_micros: 0,
            currency: CURRENCY,
        });
    }
    let rate = RATES
        .iter()
        .filter(|rate| normalized.starts_with(rate.pattern))
        .max_by_key(|rate| rate.pattern.len())?;
    let micros = million(input_tokens.max(0), rate.input_per_million)
        .saturating_add(million(output_tokens.max(0), rate.output_per_million));
    Some(Price {
        price_micros: micros,
        currency: CURRENCY,
    })
}

/// `tokens * per_million / 1_000_000`，中间用 `i128` 防溢出，结果饱和到 `i64`。
fn million(tokens: i64, per_million: i64) -> i64 {
    let numerator = i128::from(tokens) * i128::from(per_million);
    let micros = numerator / 1_000_000;
    i64::try_from(micros).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priced_model_uses_input_and_output_rates() {
        // deepseek-chat：入 2 元 / 出 8 元（每百万 token）
        let input_only = price("deepseek-chat", 1_000_000, 0).expect("有价");
        assert_eq!(input_only.price_micros, 2_000_000);
        assert_eq!(input_only.currency, "CNY");

        let mixed = price("deepseek-chat", 500_000, 250_000).expect("有价");
        // 0.5M * 2 元 + 0.25M * 8 元 = 1 元 + 2 元 = 3 元
        assert_eq!(mixed.price_micros, 3_000_000);
    }

    #[test]
    fn unknown_model_is_null_not_a_guess() {
        assert_eq!(price("some-new-model-2077", 1_000_000, 1_000_000), None);
        assert_eq!(price("", 10, 10), None);
        // 前后空白不该影响匹配
        assert!(price("  DeepSeek-Chat  ", 1, 1).is_some());
    }

    #[test]
    fn longest_prefix_wins() {
        let mini = price("gpt-4o-mini", 1_000_000, 0).expect("有价");
        let full = price("gpt-4o", 1_000_000, 0).expect("有价");
        assert_eq!(mini.price_micros, 1_100_000);
        assert_eq!(full.price_micros, 18_000_000);
        assert!(mini.price_micros < full.price_micros);
        // 带日期后缀的实参仍然命中前缀
        assert!(price("gpt-4o-mini-2024-07-18", 1, 1).is_some());
    }

    #[test]
    fn local_models_cost_zero() {
        for model in ["ollama/qwen2.5-coder:7b", "lmstudio/qwen3", "local/llama3"] {
            let priced = price(model, 9_999_999, 9_999_999).expect("本地也要记一行");
            assert_eq!(priced.price_micros, 0, "{model} 是本地推理");
        }
    }

    #[test]
    fn dirty_tokens_never_go_negative_or_overflow() {
        let negative = price("deepseek-chat", -100, -100).expect("有价");
        assert_eq!(negative.price_micros, 0, "负 token 不该倒扣钱");
        let huge = price("deepseek-chat", i64::MAX, i64::MAX).expect("有价");
        assert_eq!(huge.price_micros, i64::MAX, "饱和而不是溢出成负数");
    }
}
