//! 双实例隔离：已安装的正式包与 `tauri dev` 同时运行。
//!
//! 默认两边用同一个 identifier（`com.cogito.client`），Tauri 据此派生的所有「进程唯一」
//! 资源都会撞车：
//!
//! - `tauri-plugin-single-instance` 的互斥量 → 后启动的那个直接退出（dev 根本起不来）；
//! - `<appLocalData>`（`cogito-client.db`、`knowledge/`、`logs/`、`EBWebView/`）→ 同一个
//!   SQLite 文件 + 同一个 WebView2 profile（WebView2 不支持两个进程共用 profile）；
//! - `<appData>`（goose 数据、`cogito/jwt`）→ 同目录；
//! - 本模块兜住的**写死的名字**：corex-daemon 的 Named Pipe、剪藏/知识库 HTTP 端口、
//!   窗口/托盘标题。
//!
//! 做法：`tauri dev --config src-tauri/tauri.dev.conf.json` 把 identifier 覆盖成
//! [`DEV_IDENTIFIER`]，上面那些由 identifier 派生的东西自动分开；同时在进程内带
//! `COGITO_DEV_ISOLATED=1`，让**Tauri 起来之前**就要用的路径（`main.rs` 的 token
//! helper、`utils::diagnostics` 的 panic 现场）也认到 `.dev` 目录。
//!
//! 统一入口：`pnpm --filter @cogito/client dev:isolated`。
//! 正式包不带这个开关，行为与之前完全一致。

use std::path::PathBuf;
use std::sync::OnceLock;

/// 正式包 identifier（与 `tauri.conf.json` 一致）。
pub const BASE_IDENTIFIER: &str = "com.cogito.client";
/// 隔离 dev 实例 identifier（与 `tauri.dev.conf.json` 一致）。
pub const DEV_IDENTIFIER: &str = "com.cogito.client.dev";
/// 打开隔离实例的开关（由 `dev:isolated` 脚本注入）。
pub const ISOLATED_ENV: &str = "COGITO_DEV_ISOLATED";

/// setup 里校准过的 identifier（Tauri 侧才是权威：数据目录、单实例锁都由它派生）。
static IDENTIFIER: OnceLock<String> = OnceLock::new();

fn env_flag_enabled(raw: Option<&str>) -> bool {
    matches!(
        raw.map(str::trim),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("on")
    )
}

/// 进程启动时（Tauri 之前）该用的 identifier：只看环境开关。
///
/// panic hook 与 token helper 早于 `setup`，只能用这个值；[`init`] 之后以 config 为准。
pub fn env_identifier() -> &'static str {
    if env_flag_enabled(std::env::var(ISOLATED_ENV).ok().as_deref()) {
        DEV_IDENTIFIER
    } else {
        BASE_IDENTIFIER
    }
}

/// 用 `app.config().identifier` 校准；与开关不一致时喊一嗓子（否则数据目录和
/// panic/token 路径会分叉，排查起来极难）。
pub fn init(identifier: &str) {
    let expected = env_identifier();
    if identifier != expected {
        tracing::error!(
            config_identifier = identifier,
            expected,
            "实例 identifier 与环境开关不一致：数据目录/单实例锁按 config 走，\
             panic 现场与 token helper 按环境开关走。请用 `pnpm --filter @cogito/client dev:isolated` 启动"
        );
    }
    let _ = IDENTIFIER.set(identifier.to_string());
}

/// 当前生效的 identifier（`init` 之前回退到环境开关）。
pub fn identifier() -> &'static str {
    IDENTIFIER
        .get()
        .map_or_else(env_identifier, |value| value.as_str())
}

/// 是否隔离实例（identifier 带 `.dev` 后缀）。
pub fn isolated() -> bool {
    identifier().ends_with(".dev")
}

/// `<appData>/<identifier>`（Windows = `%APPDATA%\<identifier>`）。
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|base| base.join(identifier()))
}

/// `<appLocalData>/<identifier>`（Windows = `%LOCALAPPDATA%\<identifier>`）。
pub fn app_local_data_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join(identifier()))
}

/// corex-daemon 的 Named Pipe 名（daemon 侧收到同一个 `--pipe` 值）。
///
/// 两个实例共用一个管道时，dev 的调用会打进正式包的 daemon（写正式包的数据目录），
/// 必须分开。
pub fn corex_pipe_name() -> &'static str {
    if isolated() {
        r"\\.\pipe\corex-dev"
    } else {
        r"\\.\pipe\corex"
    }
}

/// 剪藏 / 知识库本机 HTTP 端口（`CLIP_PORT`）。
pub fn clip_port() -> u16 {
    if isolated() { 19829 } else { 19828 }
}

/// 视觉上区分两个窗口 / 托盘：`cogito` → `cogito (dev)`。
#[must_use]
pub fn label(base: &str) -> String {
    if isolated() {
        format!("{base} (dev)")
    } else {
        base.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        assert!(env_flag_enabled(Some("1")));
        assert!(env_flag_enabled(Some(" true ")));
        assert!(env_flag_enabled(Some("on")));
        assert!(!env_flag_enabled(None));
        assert!(!env_flag_enabled(Some("0")));
        assert!(!env_flag_enabled(Some("")));
    }

    #[test]
    fn dev_identifier_has_dev_suffix() {
        assert!(DEV_IDENTIFIER.ends_with(".dev"));
        assert!(!BASE_IDENTIFIER.ends_with(".dev"));
        assert!(DEV_IDENTIFIER.starts_with(BASE_IDENTIFIER));
    }
}
