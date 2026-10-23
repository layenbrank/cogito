//! 价目窗口：把「某个租户在某段时间用什么价」表达成可判定的区间关系。
//!
//! 这里刻意**不做查库取价**——取价发生在对账 SQL 的 JOIN 条件里（见 README「对外接口」）。
//! 本模块只提供两侧共用的判定与校验：手写的新增/改价请求会走同一套区间规则，
//! 免得 SQL 与 Rust 各有一套「什么算重叠」。

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::money::amount_cents;

/// 价格生效窗口，左闭右开：`effectiveFrom <= at < effectiveTo`。
///
/// 右端 `None` = 无限期。改价的正确做法是「先给旧窗口补上结束时间，再开一个新窗口」，
/// 因此两个窗口可以首尾相接（`[a, b)` 与 `[b, c)`）而不算重叠；中间若留下空隙，
/// 对账会把它当成「未定价」显式报出来，而不是静默沿用旧价。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    from: DateTime<Utc>,
    to: Option<DateTime<Utc>>,
}

impl Window {
    /// 构造一个窗口。结束时间必须严格晚于开始时间；要表示无限期请传 `None` 或用 `open`。
    pub fn new(from: DateTime<Utc>, to: Option<DateTime<Utc>>) -> Result<Self, PriceError> {
        if to.is_some_and(|to| to <= from) {
            return Err(PriceError::WindowInvalid);
        }
        Ok(Self { from, to })
    }

    /// 从 `from` 起长期生效。
    pub fn open(from: DateTime<Utc>) -> Self {
        Self { from, to: None }
    }

    pub fn start(&self) -> DateTime<Utc> {
        self.from
    }

    pub fn end(&self) -> Option<DateTime<Utc>> {
        self.to
    }

    pub fn contains(&self, at: DateTime<Utc>) -> bool {
        at >= self.from && self.to.is_none_or(|to| at < to)
    }

    /// 两个左闭右开区间是否相交。
    ///
    /// 判定式是 `a.start < b.end && b.start < a.end`；无限期用 `MAX_UTC` 代替，
    /// 因为它是 chrono 能表示的「比任何用量时间都晚」的值，不会把空窗口误判成有交集。
    pub fn overlaps(&self, other: &Self) -> bool {
        let self_end = self.to.unwrap_or(DateTime::<Utc>::MAX_UTC);
        let other_end = other.to.unwrap_or(DateTime::<Utc>::MAX_UTC);
        self.from < other_end && other.from < self_end
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PriceError {
    #[error("价格生效区间无效：结束时间必须晚于开始时间")]
    WindowInvalid,
    #[error("同一租户下该型号已有重叠的价格窗口")]
    WindowOverlap {
        tenant_id: Option<Uuid>,
        model_id: Uuid,
    },
    #[error("单价不能为负")]
    NegativeAmount,
    #[error("币种必须是 3 位大写字母代码")]
    CurrencyInvalid,
    #[error(transparent)]
    Money(#[from] crate::money::MoneyError),
}

/// 一条待写入的价目。
///
/// 字段公开、不用构造函数，是为了让调用方（HTTP 层）直接按 DTO 拼装，
/// 同时避免一个九参数构造器被 `clippy::too_many_arguments` 劝退。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriceDraft {
    /// `None` = 平台默认价；`Some` = 该租户的专属价（取价时专属价优先）。
    pub tenant_id: Option<Uuid>,
    pub model_id: Uuid,
    /// 写入时对型号名做快照，避免型号改名后旧账目说不清当时按哪个型号计价。
    pub model_name: String,
    pub currency: String,
    /// 分 / 百万 token。
    pub input_per_million: i64,
    /// 分 / 百万 token。
    pub output_per_million: i64,
    pub window: Window,
}

impl PriceDraft {
    /// 只做「数据本身是否自洽」的检查；区间重叠需要查库，由 [`PriceDraft::ensure_no_overlap`] 负责。
    pub fn validate(&self) -> Result<(), PriceError> {
        if self.input_per_million < 0 || self.output_per_million < 0 {
            return Err(PriceError::NegativeAmount);
        }
        if !is_currency_code(&self.currency) {
            return Err(PriceError::CurrencyInvalid);
        }
        Ok(())
    }

    /// 与同一 `(租户, 型号)` 下已有的窗口比对，重叠即拒绝（409 语义）。
    pub fn ensure_no_overlap(&self, existing: &[Window]) -> Result<(), PriceError> {
        if existing.iter().any(|window| window.overlaps(&self.window)) {
            return Err(PriceError::WindowOverlap {
                tenant_id: self.tenant_id,
                model_id: self.model_id,
            });
        }
        Ok(())
    }

    /// 按本条价目折算金额（单位：分）。
    pub fn amount_cents(
        &self,
        prompt_tokens: i64,
        completion_tokens: i64,
    ) -> Result<i64, crate::money::MoneyError> {
        amount_cents(
            prompt_tokens,
            completion_tokens,
            self.input_per_million,
            self.output_per_million,
        )
    }
}

/// 币种形状校验：3 位大写 ASCII 字母（`CNY` / `USD`）。
///
/// 只校验形状，不维护币种清单——结算币种由订单配置决定，
/// 价格币种必须与之相等这条规则属于业务口径，放在 service 层。
fn is_currency_code(currency: &str) -> bool {
    currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uid(byte: u8) -> Uuid {
        Uuid::from_bytes([byte; 16])
    }

    fn ts(secs: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(secs, 0).expect("valid timestamp")
    }

    fn window(from: i64, to: Option<i64>) -> Window {
        Window::new(ts(from), to.map(ts)).expect("valid window")
    }

    fn draft(tenant_id: Option<Uuid>, window: Window) -> PriceDraft {
        PriceDraft {
            tenant_id,
            model_id: uid(2),
            model_name: "gpt-x".to_string(),
            currency: "CNY".to_string(),
            input_per_million: 80,
            output_per_million: 240,
            window,
        }
    }

    #[test]
    fn half_open_window_contains_start_but_not_end() {
        let w = window(100, Some(200));
        assert!(!w.contains(ts(99)));
        assert!(w.contains(ts(100)));
        assert!(w.contains(ts(199)));
        assert!(!w.contains(ts(200)));
    }

    #[test]
    fn open_window_runs_to_forever() {
        let w = Window::open(ts(100));
        assert_eq!(w.start(), ts(100));
        assert_eq!(w.end(), None);
        assert!(!w.contains(ts(99)));
        assert!(w.contains(ts(i64::from(i32::MAX))));
    }

    #[test]
    fn empty_or_inverted_window_is_rejected() {
        assert_eq!(
            Window::new(ts(100), Some(ts(100))),
            Err(PriceError::WindowInvalid)
        );
        assert_eq!(
            Window::new(ts(200), Some(ts(100))),
            Err(PriceError::WindowInvalid)
        );
    }

    #[test]
    fn back_to_back_windows_do_not_overlap() {
        let previous = window(100, Some(200));
        let next = window(200, None);
        assert!(!previous.overlaps(&next));
        assert!(!next.overlaps(&previous));
    }

    #[test]
    fn a_single_instant_of_overlap_counts() {
        let a = window(100, Some(200));
        assert!(a.overlaps(&window(199, Some(300))));
        assert!(a.overlaps(&window(100, Some(200))));
        assert!(a.overlaps(&window(0, None)));
        assert!(!a.overlaps(&window(300, None)));
    }

    #[test]
    fn overlap_is_detected_per_tenant_and_model() {
        let existing = window(100, None);
        let overlapping = draft(Some(uid(1)), window(150, None));
        assert_eq!(
            overlapping.ensure_no_overlap(&[existing]),
            Err(PriceError::WindowOverlap {
                tenant_id: Some(uid(1)),
                model_id: uid(2)
            })
        );
        // 同一个 `(租户, 型号)` 但区间不碰：允许
        let disjoint = draft(Some(uid(1)), window(0, Some(100)));
        assert_eq!(disjoint.ensure_no_overlap(&[existing]), Ok(()));
    }

    #[test]
    fn validation_rejects_negative_price_and_bad_currency() {
        let mut bad_amount = draft(None, window(0, None));
        bad_amount.output_per_million = -1;
        assert_eq!(bad_amount.validate(), Err(PriceError::NegativeAmount));

        for currency in ["cny", "CNYX", "CN", "人民币"] {
            let mut bad_currency = draft(None, window(0, None));
            bad_currency.currency = currency.to_string();
            assert_eq!(bad_currency.validate(), Err(PriceError::CurrencyInvalid));
        }

        assert_eq!(draft(None, window(0, None)).validate(), Ok(()));
    }

    #[test]
    fn draft_prices_delegate_to_the_money_formula() {
        let draft = draft(None, window(0, None));
        assert_eq!(draft.amount_cents(1_000_000, 500_000), Ok(200));
    }
}
