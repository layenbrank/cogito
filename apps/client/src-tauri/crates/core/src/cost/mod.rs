//! 成本账本（S8）。
//!
//! 两个文件，职责分开：
//! - `pricing`：纯函数价目表（未知模型 → `None`，不猜价）；
//! - `ledger`：表读写（落账 / 裁剪 / 导出用到的 recent + totals）。
//!
//! 表结构单源在 `cogito_database::migrations::run_cost_schema`；写入点只有
//! `agent_usage::Service::write_one` 一处（用量与账本同一条路径）。
pub mod ledger;
pub mod pricing;

pub use ledger::{Draft, Entry, Totals};
pub use pricing::{CURRENCY, Price, price};
