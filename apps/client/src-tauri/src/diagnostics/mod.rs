//! 诊断 IPC：前端日志落盘、崩溃补偿上报、能力自述。
//!
//! 设计上**不新开日志文件**：`diagnostics:append` 走 `log` facade
//! （`tauri-plugin-log` 已把 `log` 装到 Stdout + LogDir），所以前端 webview 的
//! `console.error` / `window.onerror` 会和 Rust 侧 `tracing::error!` 落在同一个
//! `logs/cogito.log` 里，时间线可以直接对齐。
//!
//! 崩溃现场由 `utils::diagnostics` 在 panic hook 里落盘，这里只负责
//! 「列出来 → 交给前端上报 → ack 删除」。

pub mod command;
