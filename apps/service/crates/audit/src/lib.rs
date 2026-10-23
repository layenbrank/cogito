//! 事件与审计能力内核（数据所有权见 README.md）。
//!
//! 这里只回答两件事：**事件是什么**（[`Event`] / [`EventType`] / [`Envelope`]）、
//! **怎么把它安全地搬运出去**（[`append`] / [`Publisher`] / [`consume_once`]）。
//!
//! 不依赖 HTTP 框架、不依赖 `cogito`（R1），也不自己建连接池或事件循环：
//! 投递方式由调用方通过 [`Dispatcher`] 注入，跨租户读 outbox 的特权通道由
//! [`PlatformChannel`] 注入——本 crate 只保证「至少一次」与「同事务」这两条语义。
//!
//! ```no_run
//! use audit::{Event, EventType, append};
//! # async fn demo(tx: &sea_orm::DatabaseTransaction) -> Result<(), Box<dyn std::error::Error>> {
//! let event = Event::new(
//!     "subscription",
//!     uuid::Uuid::new_v4(),
//!     EventType::parse("subscription.renewed")?,
//!     serde_json::json!({ "plan": "TEAM" }),
//! );
//! // 与业务写入共用一个事务：提交则一起在，回滚则一起没
//! append(tx, &event).await?;
//! # Ok(()) }
//! ```

mod error;
mod event;
mod publisher;
mod store;

pub use error::AuditError;
pub use event::{Envelope, Event, EventType};
pub use publisher::{
    DispatchError, Dispatcher, PublishFailure, PublishOutcome, Publisher, PublisherOptions,
};
pub use store::{PlatformChannel, append, consume_once};
