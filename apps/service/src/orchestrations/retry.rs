//! 活动的「可重试性」判定与退避：把上游错误翻译成编排能理解的两种语义。
//!
//! 为什么不用框架自带的 `schedule_activity_with_retry`：它只按「错误重试、超时不重试」
//! 判断，而我们需要「4xx 立刻失败、429/5xx/超时退避重来」。所以重试循环写在编排里，
//! 由编排决定分支（确定性），由活动决定分类（只有活动知道下游回了什么）。
//!
//! 通道是错误字符串前缀：活动把 `ComputeError::is_retryable()` 的结果翻译成
//! `transient:` / `permanent:`，编排按前缀走分支。**未知前缀一律当 permanent** ——
//! 认不出来的错误去重试，等于拿下游当靶子。

use std::time::Duration;

use durable::OrchestrationContext;

/// 活动失败：可重试（限流、下游 5xx、超时、传输失败）。
pub const TRANSIENT: &str = "transient:";
/// 活动失败：不可重试（请求本身有问题，重试只会重复失败）。
pub const PERMANENT: &str = "permanent:";

/// 单个活动最多尝试几次（含首次）。退避总和约 15 秒，配合活动自身超时足够跨过抖动。
pub const MAX_ATTEMPTS: u32 = 5;

/// 一次重试的最长等待。
const MAX_BACKOFF: Duration = Duration::from_secs(8);

pub fn transient(reason: impl AsRef<str>) -> String {
    format!("{TRANSIENT}{}", reason.as_ref())
}

pub fn permanent(reason: impl AsRef<str>) -> String {
    format!("{PERMANENT}{}", reason.as_ref())
}

/// 是否属于「重试没有意义」的失败。未知前缀按不可重试处理。
pub fn is_permanent(error: &str) -> bool {
    !error.starts_with(TRANSIENT)
}

/// 第 `attempt` 次失败后的等待时间（1s、2s、4s、8s 封顶）。
///
/// 必须是**纯函数**：编排重放时会用同一个 `attempt` 再算一次，结果必须一致。
pub fn backoff(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(3);
    Duration::from_secs(1 << exponent).min(MAX_BACKOFF)
}

/// 去掉分类前缀，只留给人看的错误。
pub fn reason(error: &str) -> &str {
    error
        .strip_prefix(TRANSIENT)
        .or_else(|| error.strip_prefix(PERMANENT))
        .unwrap_or(error)
}

/// 跑一个活动，按 `transient:` 退避重试，最终失败时把前缀去掉再往上抛。
pub async fn run_activity(
    ctx: &OrchestrationContext,
    activity: &str,
    input: &str,
) -> Result<String, String> {
    let mut attempt = 1;
    loop {
        match ctx.schedule_activity(activity, input).await {
            Ok(output) => return Ok(output),
            Err(error) if !is_permanent(&error) && attempt < MAX_ATTEMPTS => {
                ctx.trace_warn(format!(
                    "活动 {activity} 第 {attempt} 次失败（可重试），稍后重来：{}",
                    reason(&error)
                ));
                ctx.schedule_timer(backoff(attempt)).await;
                attempt += 1;
            }
            Err(error) => {
                if !is_permanent(&error) {
                    ctx.trace_error(format!(
                        "活动 {activity} 重试 {MAX_ATTEMPTS} 次仍失败：{}",
                        reason(&error)
                    ));
                }
                return Err(reason(&error).to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_carry_the_classification() {
        assert!(!is_permanent(&transient("429")));
        assert!(is_permanent(&permanent("400")));
        assert!(is_permanent("没有前缀的错误"), "未知分类必须按不可重试处理");
        assert_eq!(reason(&transient("429")), "429");
        assert_eq!(reason(&permanent("400")), "400");
        assert_eq!(reason("裸错误"), "裸错误");
    }

    #[test]
    fn backoff_is_deterministic_and_capped() {
        let seen: Vec<u64> = (1..MAX_ATTEMPTS).map(|a| backoff(a).as_secs()).collect();
        assert_eq!(seen, vec![1, 2, 4, 8]);
        assert_eq!(backoff(1), backoff(1), "同一个 attempt 必须算出同一个值");
        assert!(backoff(99) <= MAX_BACKOFF, "退避必须有上界");
    }

    #[test]
    fn constants_are_stable() {
        // 活动与编排之间靠前缀通信，改这些字面量等于改了协议。
        assert_eq!(TRANSIENT, "transient:");
        assert_eq!(PERMANENT, "permanent:");

        // 除最后一次之外的每次失败都要能算出一个等待。
        let waits: Vec<u64> = (1..MAX_ATTEMPTS).map(|a| backoff(a).as_secs()).collect();
        assert_eq!(waits.len() as u32, MAX_ATTEMPTS - 1);
    }
}
