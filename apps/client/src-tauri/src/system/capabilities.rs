//! 运行期能力探测：这个安装包是 `slim` 还是 `full`、各外部工具到底在不在。
//!
//! 精简体（默认）裁掉了 `pandoc` / `ffmpeg` / `ffprobe`，所以运行期**必须**能
//! 自己说清楚「缺什么、为什么缺、怎么办」——`media:export` 之类命令的报错文案
//! 也走这里（见 `media/command.rs` 的 `missing_tool_message`）。
//!
//! 探测顺序：运行时下载目录 → 资源目录 → 资源目录/binaries → 可执行文件目录
//! → 可执行文件目录/binaries（dev 里再沿 exe 祖先找 `binaries/`，target 常被重定向到仓库外）。
//! 版本号是「尽力而为」：`<exe> --version` 用 1.2s 超时跑，拿不到就返回 `None`
//! （工具是第三方二进制，卡住不能拖死设置页），并按「路径 + mtime」缓存 10 分钟。

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

/// 版本号探测的超时：拿不到就放弃（工具是第三方二进制，卡住不能拖死设置页）。
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_millis(1_200);

/// 版本缓存有效期。
///
/// 「设置 → 诊断」每打开一次就串 6 个外部进程，在装了杀软的机器上每个都能跑到超时；
/// 同一份二进制（路径 + mtime 不变）短时间内没必要反复问。
const VERSION_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

struct CachedVersion {
    version: Option<String>,
    at: Instant,
}

fn version_cache() -> &'static Mutex<HashMap<(PathBuf, u128), CachedVersion>> {
    static CACHE: OnceLock<Mutex<HashMap<(PathBuf, u128), CachedVersion>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 文件指纹（mtime，毫秒）：升级二进制后要重新探测
fn file_stamp(path: &Path) -> u128 {
    std::fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|stamp| stamp.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

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
    /// 当前平台能不能在线补装（`ffprobe` 跟着 `ffmpeg` 走）
    pub installable: bool,
    /// 是否来自 `<appLocalData>/sidecar`：用户下载的那份，可以卸载
    pub installed: bool,
    /// 安装 / 卸载时传的包键（`ffprobe` → `ffmpeg`）；不可安装为 `None`
    pub install_key: Option<String>,
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

/// 缺失工具的说明文案。
///
/// 能在线补装的（slim 包里的 ffmpeg / pandoc）直接指向「一键下载」，不要把人赶去
/// 重装完整版；不能补装的才是真的需要重装。
fn missing_hint(
    label: &str,
    key: &str,
    full_only: bool,
    variant: &str,
    installable: bool,
) -> String {
    if full_only && variant != "full" && installable {
        // 体积数字按实际打包量级给，不要编精确值
        format!("精简版未内置{label}（约 40–90 MB），可在 设置 → 诊断 → 完整版能力 一键下载")
    } else if full_only && variant != "full" {
        format!("精简版未内置{label}，需要时请安装完整版：设置 → 诊断 → 完整版能力")
    } else {
        format!("未找到{label}；请重新安装，或在 设置 → 诊断 里检查安装目录（{key}）")
    }
}

fn candidate_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    // 运行时下载的那份优先于随包那份：用户显式下过就以他为准
    let mut dirs: Vec<PathBuf> = crate::system::tools::installed_dirs();
    if let Ok(resource) = app.path().resource_dir() {
        dirs.push(resource.clone());
        dirs.push(resource.join("binaries"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("binaries"));
            // dev：target 目录可能被重定向到仓库外，二进制仍在 `src-tauri/binaries`。
            // 与 `media::command::find_tool_path` 同口径向上找，否则诊断页会误报缺失。
            for ancestor in parent.ancestors().take(10) {
                dirs.push(ancestor.join("binaries"));
                dirs.push(
                    ancestor
                        .join("apps")
                        .join("client")
                        .join("src-tauri")
                        .join("binaries"),
                );
            }
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
///
/// 两点必须做对：
/// 1. 超时要**杀掉子进程**——只 `recv_timeout` 会留下 `corex-daemon --version` 这类孤儿进程，
///    反复打开设置页就会越积越多；
/// 2. stderr 直接丢到 null，stdout 交给读线程，避免子进程写满管道后在 `try_wait` 里假死。
fn probe_version(path: &Path) -> Option<String> {
    let key = (path.to_path_buf(), file_stamp(path));
    {
        let cache = version_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = cache.get(&key) {
            if entry.at.elapsed() < VERSION_CACHE_TTL {
                return entry.version.clone();
            }
        }
    }

    let version = run_version_command(path);
    let mut cache = version_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(
        key,
        CachedVersion {
            version: version.clone(),
            at: Instant::now(),
        },
    );
    version
}

fn run_version_command(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // Windows：不要为一次版本探测弹一个控制台窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = stdout;
        let mut buffer = Vec::new();
        let _ = reader.read_to_end(&mut buffer);
        let _ = sender.send(buffer);
    });

    let deadline = Instant::now() + VERSION_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }

    let buffer = receiver.recv_timeout(Duration::from_millis(300)).ok()?;
    let text = String::from_utf8_lossy(&buffer);
    let first = text.lines().next().unwrap_or("").trim();
    if first.is_empty() {
        None
    } else {
        // 版本串可能很长，截断避免 UI 撑破
        Some(first.chars().take(120).collect())
    }
}

fn tool_from_spec(
    spec: &ToolSpec,
    located: Option<(PathBuf, Option<String>)>,
    variant: &str,
) -> ToolCapability {
    let present = located.is_some();
    let installed = located
        .as_ref()
        .map(|(found, _)| crate::system::tools::is_installed_path(found))
        .unwrap_or(false);
    let install_key = crate::system::tools::package_for(spec.key).map(str::to_string);
    let installable = crate::system::tools::is_installable(spec.key);
    let (path, version) = match located {
        Some((found, version)) => (Some(found), version),
        None => (None, None),
    };
    ToolCapability {
        key: spec.key.to_string(),
        label: spec.label.to_string(),
        present,
        path: path.map(|found| found.display().to_string()),
        version,
        full_only: spec.full_only,
        hint: if present {
            None
        } else {
            Some(missing_hint(
                spec.label,
                spec.key,
                spec.full_only,
                variant,
                installable,
            ))
        },
        installable,
        installed,
        install_key,
    }
}

#[cfg(test)]
fn probe_tool(dirs: &[PathBuf], spec: &ToolSpec, variant: &str) -> ToolCapability {
    let located = find_in_dirs(dirs, spec.names).map(|found| {
        let version = probe_version(&found);
        (found, version)
    });
    tool_from_spec(spec, located, variant)
}

/// 能力自述：档位 + 每个工具的存在性与版本。
///
/// **必须异步**：同步 `#[tauri::command]` 跑在 Tauri 主线程上，这里要起外部进程，
/// 卡住就是整页冻结（实测最坏 6 × 1.5s）。现在扔进阻塞线程池，并让各工具并行探测。
#[tauri::command(rename = "capabilities:probe")]
pub async fn capabilities_probe(app: tauri::AppHandle) -> Result<Capabilities, String> {
    tauri::async_runtime::spawn_blocking(move || probe_all(&app))
        .await
        .map_err(|error| format!("能力探测线程异常：{error}"))
}

fn probe_all(app: &tauri::AppHandle) -> Capabilities {
    let variant = variant();
    let dirs = candidate_dirs(app);
    // 先定位（纯 exists，微秒级），再并行取版本：串行时最坏 6 × 1.2s
    let located: Vec<Option<PathBuf>> = TOOLS
        .iter()
        .map(|spec| find_in_dirs(&dirs, spec.names))
        .collect();
    let handles: Vec<_> = located
        .into_iter()
        .map(|found| {
            std::thread::spawn(move || {
                found.map(|path| {
                    let version = probe_version(&path);
                    (path, version)
                })
            })
        })
        .collect();
    let tools = TOOLS
        .iter()
        .zip(handles)
        .map(|(spec, handle)| {
            let located = handle.join().ok().flatten();
            tool_from_spec(spec, located, &variant)
        })
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
    fn missing_full_only_tool_points_to_download() {
        let hint = missing_hint("FFmpeg（媒体导出 / 转码）", "ffmpeg", true, "slim", true);
        assert!(hint.contains("精简版未内置"), "{hint}");
        assert!(hint.contains("设置 → 诊断"), "{hint}");
        assert!(
            hint.contains("一键下载"),
            "能在线补装时应该指向下载: {hint}"
        );
    }

    #[test]
    fn missing_full_only_without_package_points_to_full_version() {
        let hint = missing_hint("FFmpeg", "ffmpeg", true, "slim", false);
        assert!(hint.contains("安装完整版"), "{hint}");
    }

    #[test]
    fn missing_core_tool_asks_for_reinstall() {
        let hint = missing_hint("Goose agent 运行时", "goose", false, "full", false);
        assert!(hint.contains("未找到"), "{hint}");
        assert!(!hint.contains("精简版"), "核心件缺失不该怪精简版: {hint}");
    }

    #[test]
    fn find_in_dirs_matches_binaries_subdir() {
        let dir = temp_dir("find");
        fs::create_dir_all(dir.join("binaries")).expect("建 binaries");
        let target = dir.join("binaries").join("ffmpeg.exe");
        fs::write(&target, b"stub").expect("写桩");
        let found = find_in_dirs(
            &[dir.join("nothing"), dir.clone()],
            &["ffmpeg.exe", "binaries/ffmpeg.exe"],
        );
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
        assert!(!capability.installed);
        assert!(capability.version.is_none());
        assert!(capability.hint.is_some());
        // 平台有直链时应该告诉前端「可以装」，而不是只有一句缺失
        assert_eq!(capability.install_key.as_deref(), Some("ffmpeg"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_package_tools_are_not_installable() {
        let dir = temp_dir("nopkg");
        let spec = &TOOLS[0]; // corex
        let capability = probe_tool(&[dir.clone()], spec, "slim");
        assert!(!capability.installable);
        assert!(capability.install_key.is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
