//! 本机定时任务的执行侧：只负责「到期了就把活儿交给前端」。
//!
//! 为什么不在这里直接跑：一次执行要么起 ACP 会话（会话挂在 WebView 侧的 goose 连接上），
//! 要么落在知识库服务里；前者 Rust 侧根本没有通道。所以 worker 只做 claim + 发事件，
//! 前端跑完再回写 `automation:finishRun`。
//!
//! 由此带来一个必须写清的语义：**应用没运行就等于没执行**。`owner=client` 本来就是这个
//! 含义；需要「关掉客户端也照跑」的任务应当用 `owner=cloud`（Phase 7C）。

pub mod command;
pub mod goose;
pub mod worker;
pub use worker::spawn_worker;
