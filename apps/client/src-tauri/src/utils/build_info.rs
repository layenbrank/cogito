//! 宿主构建指纹：让「现在跑的是哪一份二进制」变成可读事实。
//!
//! 为什么需要它：dev 里最常踩的坑是**宿主没重建** —— 前端热更新了，Rust 侧还是启动时那个
//! 进程，于是「截图 10s 超时 / 拦截一条都不命中 / 终端里没有 `COGITO_AGENT_CACHE`」会被
//! 当成新回归去查，白烧一轮。这里只暴露运行时真的读得到的东西：版本、debug/release、
//! 可执行文件路径与**链接时间**、pid。链接时间明显早于仓库最新提交，就说明这个进程跑的是旧代码。
//!
//! 刻意不做的事：不读 git（dev 的 target 目录可能是别处、也可能没有 .git）、
//! 不加 vergen 依赖 —— 可执行文件 mtime 已经足够回答「重建过没有」。

use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    /// `Cargo.toml` 的 package version
    pub version: String,
    /// `debug` / `release`
    pub profile: String,
    /// 当前进程的可执行文件绝对路径
    pub exe: String,
    /// 可执行文件的修改时间（ms since epoch）＝ 链接时间；0 表示读不到
    pub exe_modified_ms: u64,
    /// 进程号：同一份二进制重启后 pid 会变，用来区分「重建了」与「重启了」
    pub pid: u32,
}

fn modified_ms(path: &Path) -> u64 {
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    let Ok(stamp) = meta.modified() else {
        return 0;
    };
    stamp
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

pub fn build_info() -> BuildInfo {
    let exe = std::env::current_exe().unwrap_or_default();
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        profile: profile().to_string(),
        exe: exe.display().to_string(),
        exe_modified_ms: modified_ms(&exe),
        pid: std::process::id(),
    }
}

/// 宿主构建指纹（`app_build_info`）：诊断页与 agent 的环境上下文都读它
#[tauri::command]
pub fn app_build_info() -> BuildInfo {
    build_info()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_is_known() {
        assert!(matches!(profile(), "debug" | "release"));
    }

    #[test]
    fn current_exe_has_a_link_time() {
        // 测试进程本身也是链接出来的：mtime 必须读得到，否则前端就没法判断「重建过没有」
        let exe = std::env::current_exe().expect("current_exe");
        assert!(modified_ms(&exe) > 0, "{} 读不到修改时间", exe.display());
    }

    #[test]
    fn build_info_reports_this_process() {
        let info = build_info();
        assert_eq!(info.pid, std::process::id());
        assert!(!info.version.is_empty());
        assert!(info.exe_modified_ms > 0);
        assert!(matches!(info.profile.as_str(), "debug" | "release"));
    }
}
