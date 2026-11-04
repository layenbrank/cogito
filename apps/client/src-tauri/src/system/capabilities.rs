//! 运行期能力探测：这个安装包是 `slim` 还是 `full`、各外部工具到底在不在。
//!
//! 精简体（默认）裁掉了 `pandoc` / `ffmpeg` / `ffprobe`，所以运行期**必须**能
//! 自己说清楚「缺什么、为什么缺、怎么办」——`media:export` 之类命令的报错文案
//! 也走这里（见 `media/command.rs` 的 `missing_tool_message`）。
//!
//! 探测顺序：资源目录 → 资源目录/binaries → 可执行文件目录 → 可执行文件目录/binaries。
//! 版本号是「尽力而为」：`<exe> --version` 用 1.5s 超时跑，拿不到就返回 `None`
//! （工具是第三方二进制，卡住不能拖死设置页）。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;

/// 版本号探测的超时：拿不到就当 `None`。
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapability {
    pub key: String,
    pub label: String,
    /// 文件是否存在
    pub present: bool,
    /// 找到的绝对路径
    pub path: Option<String>,
    /// `--version` 输出（拿不到为 `None`）
    pub version: Option<String>,
    /// 只在 full 档位内置（slim 缺它是正常现象）
    pub full_only: bool,
    /// 缺失时给用户看的说明
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// `slim` / `full`
    pub variant: String,
    pub platform: String,
    pub arch: String,
    pub tools: Vec<ToolCapability>,
}

struct ToolSpec {
    key: &'static str,
    label: &'static str,
    /// 依次尝试的文件名（含相对子目录）
    names: &'static [&'static str],
    /// 只有 full 档位内置
    full_only: bool,
}

const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        key: "corex",
        label: "Corex 运行时（corex-daemon）",
        names: &["corex-daemon.exe", "corex-daemon"],
        full_only: false,
    },
    ToolSpec {
        key: "goose",
        label: "Goose agent 运行时",
        names: &["goose.exe", "goose"],
        full_only: false,
    },
    ToolSpec {
        key: "pdfium",
        label: "PDFium（PDF 解析）",
        names: &["pdfium.dll", "binaries/pdfium.dll"],
        full_only: false,
    },
    ToolSpec {
        key: "ffmpeg",
        label: "FFmpeg（媒体导出 / 转码）",
        names: &["ffmpeg.exe", "binaries/ffmpeg.exe", "ffmpeg"],
        full_only: true,
    },
    ToolSpec {
        key: "ffprobe",
        label: "FFprobe（媒体信息）",
        names: &["ffprobe.exe", "binaries/ffprobe.exe", "ffprobe"],
        full_only: true,
    },
    ToolSpec {
        key: "pandoc",
        label: "Pandoc（文档格式转换）",
        names: &["pandoc.exe", "binaries/pandoc.exe", "pandoc"],
        full_only: true,
    },
];

/// 打包档位（与 `diagnostics::command::sidecar_variant` 同源）。
fn variant() -> String {
    crate::diagnostics::command::sidecar_variant()
}

/// 缺失工具的说明文案（`full_only` 且是 slim 包时指向「完整版」）。
fn missing_hint(label: &str, key: &str, full_only: bool, variant: &str) -> String {
    if full_only && variant != "full" {
        // 体积数字按实际打包量级给，不要编精确值
        format!(
            "精简版未内置{label}（约 40–90 MB），需要时请安装完整版：设置 → 诊断 → 完整版能力"
        )
    } else {
        format!("未找到{label}；请重新安装，或在 设置 → 诊断 里检查安装目录（{key}）")
    }
}

fn candidate_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        dirs.push(resource.clone());
        dirs.push(resource.join("binaries"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("binaries"));
        }
    }
    dirs
}

fn find_in_dirs(dirs: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    for dir in dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 跑 `<exe> --version` 取首行；超时 / 失败返回 `None`。
fn probe_version(path: &Path) -> Option<String> {
    let (sender, receiver) = mpsc::channel();
    let owned = path.to_path_buf();
    std::thread::spawn(move || {
        let output = Command::new(&owned).arg("--version").output();
        let _ = sender.send(output.ok());
    });
    let output = receiver.recv_timeout(VERSION_PROBE_TIMEOUT).ok()??;
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next().unwrap_or("").trim().to_string();
    if first.is_empty() {
        None
    } else {
        // 版本串可能很长，截断避免 UI 撑破
        Some(first.chars().take(120).collect())
    }
}

fn probe_tool(dirs: &[PathBuf], spec: &ToolSpec, variant: &str) -> ToolCapability {
    let found = find_in_dirs(dirs, spec.names);
    let present = found.is_some();
    let version = found.as_deref().and_then(probe_version);
    ToolCapability {
        key: spec.key.to_string(),
        label: spec.label.to_string(),
        present,
        path: found.map(|path| path.display().to_string()),
        version,
        full_only: spec.full_only,
        hint: if present {
            None
        } else {
            Some(missing_hint(spec.label, spec.key, spec.full_only, variant))
        },
    }
}

/// 能力自述：档位 + 每个工具的存在性与版本。
#[tauri::command(rename = "capabilities:probe")]
pub fn capabilities_probe(app: tauri::AppHandle) -> Capabilities {
    let variant = variant();
    let dirs = candidate_dirs(&app);
    let tools = TOOLS
        .iter()
        .map(|spec| probe_tool(&dirs, spec, &variant))
        .collect();
    Capabilities {
        variant,
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tools,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cogito-caps-{tag}-{}-{}",
            std::process::id(),
            crate::utils::diagnostics::now_ms()
        ));
        fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    #[test]
    fn missing_full_only_tool_points_to_full_version() {
        let hint = missing_hint("FFmpeg（媒体导出 / 转码）", "ffmpeg", true, "slim");
        assert!(hint.contains("精简版未内置"), "{hint}");
        assert!(hint.contains("设置 → 诊断"), "{hint}");
    }

    #[test]
    fn missing_core_tool_asks_for_reinstall() {
        let hint = missing_hint("Goose agent 运行时", "goose", false, "full");
        assert!(hint.contains("未找到"), "{hint}");
        assert!(!hint.contains("精简版"), "核心件缺失不该怪精简版: {hint}");
    }

    #[test]
    fn find_in_dirs_matches_binaries_subdir() {
        let dir = temp_dir("find");
        fs::create_dir_all(dir.join("binaries")).expect("建 binaries");
        let target = dir.join("binaries").join("ffmpeg.exe");
        fs::write(&target, b"stub").expect("写桩");
        let found = find_in_dirs(&[dir.join("nothing"), dir.clone()], &["ffmpeg.exe", "binaries/ffmpeg.exe"]);
        assert_eq!(found.as_deref(), Some(target.as_path()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_in_dirs_returns_none_when_absent() {
        let dir = temp_dir("absent");
        assert!(find_in_dirs(&[dir.clone()], &["pandoc.exe"]).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn probe_tool_reports_hint_when_missing() {
        let dir = temp_dir("probe");
        let spec = &TOOLS[3]; // ffmpeg
        let capability = probe_tool(&[dir.clone()], spec, "slim");
        assert!(!capability.present);
        assert!(capability.version.is_none());
        assert!(capability.hint.is_some());
        let _ = fs::remove_dir_all(&dir);
    }
}
