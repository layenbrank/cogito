//! 计费与订阅能力内核（数据所有权见 README.md）。
//!
//! 这里只回答「这笔账怎么算」：**价目窗口**（[`Window`] / [`PriceDraft`]）、
//! **金额折算**（[`amount_cents`]）、**对账装配**（[`reconcile`]）。
//! 查库与协议不在这里——聚合 SQL 与 HTTP 端点都在 `service/src/services/payment/`，
//! 本 crate 负责把口径本身固定成可单测的纯函数。
//!
//! 不依赖 HTTP 框架、不依赖 `cogito`（R1），也不依赖 `entity` / `sea-orm`：
//! 数据以入参传入、以纯数据出参，因此整条口径不需要数据库即可验证。
//!
//! ```no_run
//! use billing::{PriceDraft, Window, amount_cents};
//!
//! let draft = PriceDraft {
//!     tenant_id: None, // 平台默认价
//!     model_id: uuid::Uuid::new_v4(),
//!     model_name: "gpt-x".to_string(),
//!     currency: "CNY".to_string(),
//!     input_per_million: 80,  // 分 / 百万 token
//!     output_per_million: 240,
//!     window: Window::open(chrono::Utc::now()),
//! };
//! draft.validate()?;
//!
//! // 100 万输入 token，按 ¥0.80 / 百万 token 计 → 80 分
//! assert_eq!(amount_cents(1_000_000, 0, 80, 240)?, 80);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod money;
mod price;
mod report;

pub use money::{MoneyError, amount_cents};
pub use price::{PriceDraft, PriceError, Window};
pub use report::{
    AppliedPrice, ExceptionKind, FailedGroup, ModelReconciliation, OrderGroup, OrderRef,
    ReconcileError, ReconcileException, ReconcileInput, Reconciliation, TenantReconciliation,
    Totals, UsageGroup, reconcile,
};
