pub mod app;
pub mod autostart;
pub mod automation;
pub mod diagnostics;
pub mod bridge;
pub mod browser;
pub mod knowledge;
pub mod reminder;
pub mod search;
pub mod site;
pub mod system;

pub mod through {
    pub mod command;
    pub mod cursor;
    pub mod state;
    pub mod worker;
    pub use command::set_rects;
    pub use state::ThroughState;
    pub use worker::spawn_worker;
}

pub mod overlay {
    pub mod command;
    pub mod state;
    pub mod watchdog;
    pub use state::{OverlayHealth, OverlayPending};
}

pub mod capture {
    pub mod command;
    pub mod region;
    pub mod schema;
    pub mod state;
    /// UI Automation 元素链：仅 Windows（依赖 `windows` crate）
    #[cfg(windows)]
    pub mod uia;
    pub use state::{CaptureHandshake, CapturePending};
}

pub mod media;

pub mod ui {
    pub mod contextmenu;
    pub mod native_find;
    pub mod tray;
}

pub mod utils;

// 让 lib test 可执行文件带上 Common Controls v6 manifest。
//
// lib test 会链进 `windows` crate（经 tauri），用到 `comctl32!TaskDialogIndirect`。
// 缺 manifest 时 Windows 加载器在跑第一个用例之前就以 0xc0000139
// （STATUS_ENTRYPOINT_NOT_FOUND）退出，`cargo test` 只报 "test exited abnormally"。
//
// `tauri_build::build()` 已经把该 manifest 打进 `resource.lib`，但只通过
// `cargo:rustc-link-arg-bins` 发给 bins；cargo 也没有「只给 lib 单测加 link arg」的
// 指令（`rustc-link-arg-tests` 只覆盖 `tests/` 下的集成测试目标），所以这里用
// `#[cfg(test)]` 的 `#[link]` 按需把它拉进来：正常 lib/bin 构建时这个块不参与编译，
// 链接结果与之前完全一致。搜索路径由 `build.rs` 的 `link_test_resources` 提供。
#[cfg(all(test, target_os = "windows"))]
#[link(name = "resource", kind = "static")]
unsafe extern "C" {}
