//! 可靠执行（durable execution）：把长任务写成可重放的步骤链，进程崩了也能自动续跑。
//!
//! 这是**唯一**依赖 duroxide / duroxide-pg 的地方（登记在 `scripts/capabilities.ts` 的
//! `CONFINED_CRATE_DEPS`，由 `scripts/arch.ts` 强制）。其余代码只通过本 crate 的端口
//! 使用可靠执行：将来换实现（或升到 duroxide 1.0）只动这一个 crate。
//!
//! 边界：
//! - **不碰业务表**：provider 在自己的 schema 里建表并自行迁移，不参与 `migration` 的世代，
//!   也不走 `src/guards` 的租户 / 平台通道（见 README「数据所有权」）。
//! - **不做业务判断**：编排与活动由调用方注册；本 crate 只负责存历史、重放、执行与停机。
//!
//! 用法（三段式）：
//!
//! ```no_run
//! # use std::time::Duration;
//! # use durable::{Activities, DurableSettings, Orchestrations, Runtime, RuntimeTuning, Store};
//! # async fn demo() -> Result<(), durable::DurableError> {
//! let store = Store::connect(&DurableSettings::new("postgres://.../cogito-service", "durable", true)).await?;
//!
//! // ① 编排：只写「做什么」，步骤结果由框架持久化，重放时直接复用
//! let orchestrations = Orchestrations::builder().register("IndexDocument", |ctx, input: String| async move {
//!     let chunks = ctx.schedule_activity("Chunk", input).await?;
//!     ctx.schedule_activity("Embed", chunks).await
//! });
//! // ② 活动：真正干活的副作用步骤（HTTP / IO），重试时用实例 id 做幂等键
//! let activities = Activities::builder().register("Chunk", |_ctx, input: String| async move { Ok(input) });
//!
//! // ③ 运行时（orchestrator 进程）与客户端（任何进程都可以起实例）
//! let client = store.client();
//! client.start("doc-42", "IndexDocument", &"hello").await?;
//! let runtime = Runtime::start(&store, activities, orchestrations, RuntimeTuning::default()).await?;
//! let status = client.wait("doc-42", Duration::from_secs(30)).await?;
//! runtime.shutdown(5_000).await;
//! # let _ = status;
//! # Ok(()) }
//! ```

mod client;
mod error;
mod registry;
mod runtime;
mod settings;
mod store;

pub use client::{Client, InstanceStatus};
pub use error::DurableError;
pub use registry::{Activities, Orchestrations};
pub use runtime::{Runtime, RuntimeTuning};
pub use settings::DurableSettings;
pub use store::Store;

/// 处理器签名里的上下文类型。由实现本体提供、这里转发：调用方不必在 Cargo.toml 里
/// 直接依赖 duroxide（那样就绕过了 `CONFINED_CRATE_DEPS` 的门禁）。
pub use duroxide::{ActivityContext, Either2, OrchestrationContext};
