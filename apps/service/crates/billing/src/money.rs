//! 金额折算：单价按「分 / 百万 token」报价，用量是 token 数，结果必须落回**整分**。

/// 单价的分母：价格按「每百万 token」报价，折算时统一除以它。
const TOKENS_PER_UNIT: i128 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MoneyError {
    #[error("用量或单价为负，无法折算金额")]
    Negative,
    #[error("折算结果超出 64 位整数范围（用量或单价过大）")]
    Overflow,
}

/// 折算一个用量分组的金额（单位：分）。
///
/// 公式：`round_half_up((promptTokens × 输入单价 + completionTokens × 输出单价) / 1_000_000)`。
///
/// 两个刻意的选择：
/// - **全程整数**（中间量 i128），乘加之后才做唯一一次四舍五入——避免浮点误差在对账里变成尾差；
/// - 舍入点是**分组**（租户 × 型号 × 价目），所以「每个分组各自舍入后求和」与「先求和再舍入」
///   最多相差「分组数 × 半分」。选前者是因为账单必须能按分组复算：任何一行都能独立解释，
///   而不是只有一个总数说不清从哪来。
pub fn amount_cents(
    prompt_tokens: i64,
    completion_tokens: i64,
    input_per_million: i64,
    output_per_million: i64,
) -> Result<i64, MoneyError> {
    if prompt_tokens < 0 || completion_tokens < 0 || input_per_million < 0 || output_per_million < 0
    {
        return Err(MoneyError::Negative);
    }

    let total = i128::from(prompt_tokens)
        .checked_mul(i128::from(input_per_million))
        .and_then(|input| {
            i128::from(completion_tokens)
                .checked_mul(i128::from(output_per_million))
                .and_then(|output| input.checked_add(output))
        })
        .ok_or(MoneyError::Overflow)?;

    // 非负整数的 `/` 是向下取整，先加半个单位即「四舍五入」
    let rounded = total
        .checked_add(TOKENS_PER_UNIT / 2)
        .ok_or(MoneyError::Overflow)?
        / TOKENS_PER_UNIT;

    i64::try_from(rounded).map_err(|_| MoneyError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_usage_costs_nothing() {
        assert_eq!(amount_cents(0, 0, 80, 240), Ok(0));
    }

    #[test]
    fn million_tokens_at_quoted_price() {
        // 80 分 / 百万 token = ¥0.80 / 百万 token
        assert_eq!(amount_cents(1_000_000, 0, 80, 240), Ok(80));
        assert_eq!(amount_cents(0, 500_000, 80, 240), Ok(120));
        assert_eq!(amount_cents(1_000_000, 500_000, 80, 240), Ok(200));
    }

    #[test]
    fn rounds_half_up_at_the_cent_boundary() {
        // 恰好半分 → 进位
        assert_eq!(amount_cents(500_000, 0, 1, 0), Ok(1));
        // 差一个 token 到半分 → 舍去
        assert_eq!(amount_cents(499_999, 0, 1, 0), Ok(0));
    }

    #[test]
    fn tiny_usage_rounds_down_to_zero() {
        // 1 token × ¥0.01 / 百万 token 仍然不足 1 分：报告里只有请求数，没有金额
        assert_eq!(amount_cents(1, 1, 1, 1), Ok(0));
    }

    #[test]
    fn rounding_happens_per_group_not_on_the_total() {
        // 两个分组各 0.5 分：分组各自进位（1 + 1 = 2），先求和再舍入会得到 1
        let a = amount_cents(500_000, 0, 1, 0).unwrap();
        let b = amount_cents(500_000, 0, 1, 0).unwrap();
        assert_eq!(a + b, 2);
        assert_eq!(amount_cents(1_000_000, 0, 1, 0).unwrap(), 1);
    }

    #[test]
    fn negative_inputs_are_rejected() {
        assert_eq!(amount_cents(-1, 0, 80, 240), Err(MoneyError::Negative));
        assert_eq!(amount_cents(0, 0, -1, 240), Err(MoneyError::Negative));
    }

    #[test]
    fn absurd_magnitudes_report_overflow_instead_of_wrapping() {
        assert_eq!(
            amount_cents(i64::MAX, i64::MAX, i64::MAX, i64::MAX),
            Err(MoneyError::Overflow)
        );
    }
}
