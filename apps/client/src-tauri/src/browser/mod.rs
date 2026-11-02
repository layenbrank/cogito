//! 浏览器面板：原生子 webview + 多 tab + 供 agent 读写。
//!
//! 为什么不用 iframe：目标站点大量拒绝被嵌入（`X-Frame-Options: DENY` /
//! CSP `frame-ancestors`），VS Code 的 Simple Browser 正是因此打不开 bing。
//! 原生子 webview 是完整浏览器，代价是**层级** —— 它永远盖在 HTML 之上，
//! 浮层出现时只能 `hide()` 让位（与 VS Code `BrowserView.setVisible` 同策略）。
//!
//! 安全边界（改代码时不要破坏）：
//! 1. 浏览器 webview 加载远程 origin，且**不配** capability 的 `remote.urls`，
//!    于是它天然没有任何 IPC 权限 —— 只有主 webview 能调本模块的命令；
//! 2. 拦截规则只能由 agent 会话内下发，不接受页面侧自身发起的请求；
//! 3. 所有 tab 共用同一个 WebView2 profile（= 浏览器行为：cookie / localStorage
//!    按 origin 共享，sessionStorage 每个 tab 独立）。
//!
//! 第 3 条的实现方式就是**什么都不做**：`WebviewBuilder` 不调
//! `data_directory` / `additional_browser_args` —— Tauri 运行时按 data_directory
//! 缓存 WebView2 environment，保持默认才能复用同一个。一旦给某个 tab 传了这两个
//! 方法，它会分裂出独立 profile，登录态不再共享。

pub mod agent;
pub mod cdp;
pub mod cdp_events;
pub mod command;
pub mod emulate;
pub mod intercept;
pub mod lifecycle;
pub mod network;
pub mod picker;
pub mod state;
