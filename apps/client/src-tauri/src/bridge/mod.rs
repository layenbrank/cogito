//! app 内 loopback 桥。
//!
//! 存在的理由：`cogito-mcp` 是独立进程，但它**不能**直接打开 `cogito-client.db` ——
//! 否则会出现第二个写者，绕过 store 事件与事务语义。桥把「读工具」收回 app 进程，
//! 侧车只做协议适配（MCP stdio ↔ HTTP）。
//!
//! 边界：只绑 `127.0.0.1`、每次启动轮换 token、校验 `Host` 必须是本机（挡 DNS rebinding）、
//! 不挂 CORS（浏览器同源策略下外部页面无法读取响应）。
mod http;

pub mod command;

pub use http::{BridgeInfo, BridgeState, start};
