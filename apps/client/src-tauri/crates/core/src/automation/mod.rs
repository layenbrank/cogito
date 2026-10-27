//! 定时任务：定义、排期与执行记录。
//!
//! 分工：本模块只做「什么时候该跑 + 记录跑过没有」，**不跑智能体**。
//! `owner=client` 的到期任务由 `src-tauri/src/automation/worker.rs` claim 后发事件，
//! 前端起一次性会话执行再回写结果 —— 会话只能在 WebView 里跑，Rust 侧没有模型通道。

pub mod service;
