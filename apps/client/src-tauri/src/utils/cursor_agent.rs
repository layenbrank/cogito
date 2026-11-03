//! 本机 Cursor Agent CLI（`agent` / `cursor-agent`）探测与状态。
//!
//! goose 的 `cursor-agent` 供应商依赖该 CLI 的登录态；与 Cogito JWT / 组织网关无关。
//! 文档：https://cursor.com/docs/cli/reference/authentication.md

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `agent status` 探测结果（给设置页与诊断用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAgentStatus {
    /// PATH / 常见安装目录里是否找到可执行文件
    pub found: bool,
    /// 解析到的绝对路径（若有）
    pub binary_path: Option<String>,
    /// 调用时用的命令名（`agent` 或 `cursor-agent`）
    pub binary_name: Option<String>,
    /// 是否已鉴权（`agent status` 成功且输出不含未登录语义）
    pub authenticated: bool,
    /// 是否检测到进程环境里的 `CURSOR_API_KEY`
    pub has_api_key_env: bool,
    /// `agent status` 的 stdout/stderr 摘要（截断）
    pub detail: String,
}

/// 给 goose 子进程追加的环境：扩展 PATH + 透传 `CURSOR_API_KEY`。
pub fn goose_cli_envs() -> Vec<(String, String)> {
    let mut envs = Vec::new();

    if let Some(path) = augmented_path() {
        envs.push(("PATH".into(), path));
    }

    if let Ok(key) = std::env::var("CURSOR_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            envs.push(("CURSOR_API_KEY".into(), trimmed.to_string()));
        }
    }

    envs
}

/// 探测本机 Cursor Agent 登录状态。
pub fn find_status() -> CursorAgentStatus {
    let has_api_key_env = std::env::var("CURSOR_API_KEY")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let Some((binary_path, binary_name)) = find_agent_binary() else {
        return CursorAgentStatus {
            found: false,
            binary_path: None,
            binary_name: None,
            authenticated: false,
            has_api_key_env,
            detail: "未找到 agent / cursor-agent。请安装 Cursor CLI，或把安装目录加入 PATH 后重启客户端。"
                .into(),
        };
    };

    match run_status(&binary_path) {
        Ok(output) => {
            let status_ok = is_authenticated_output(&output);
            let authenticated = status_ok || has_api_key_env;
            let detail = if authenticated {
                if has_api_key_env && !status_ok {
                    "已检测到 CURSOR_API_KEY（进程环境）；goose 重启后可用。".into()
                } else {
                    truncate_detail(&output)
                }
            } else {
                format!(
                    "{}\n（未登录时请本机执行 agent login，或设置 CURSOR_API_KEY 后完整重启客户端）",
                    truncate_detail(&output)
                )
            };
            CursorAgentStatus {
                found: true,
                binary_path: Some(binary_path.display().to_string()),
                binary_name: Some(binary_name),
                authenticated,
                has_api_key_env,
                detail,
            }
        }
        Err(error) => CursorAgentStatus {
            found: true,
            binary_path: Some(binary_path.display().to_string()),
            binary_name: Some(binary_name),
            authenticated: has_api_key_env,
            has_api_key_env,
            detail: if has_api_key_env {
                format!("{error}；已检测到 CURSOR_API_KEY，可尝试重启客户端后使用。")
            } else {
                format!("{error}。请执行 agent login 或设置 CURSOR_API_KEY。")
            },
        },
    }
}

fn find_agent_binary() -> Option<(PathBuf, String)> {
    for name in agent_names() {
        if let Some(path) = find_in_path(name) {
            return Some((path, name.to_string()));
        }
    }
    for dir in candidate_dirs() {
        for name in agent_names() {
            if let Some(path) = find_in_dir(&dir, name) {
                return Some((path, name.to_string()));
            }
        }
    }
    None
}

fn agent_names() -> &'static [&'static str] {
    &["agent", "cursor-agent"]
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".cursor").join("bin"));
        dirs.push(home.join("AppData").join("Local").join("cursor-agent"));
        dirs.push(
            home.join("AppData")
                .join("Local")
                .join("Programs")
                .join("cursor"),
        );
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let base = PathBuf::from(local);
        dirs.push(base.join("cursor-agent"));
        dirs.push(base.join("Programs").join("cursor"));
    }
    dirs
}

fn find_in_path(executable: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        if let Some(found) = find_in_dir(&dir, executable) {
            return Some(found);
        }
    }
    None
}

fn find_in_dir(dir: &Path, executable: &str) -> Option<PathBuf> {
    let candidate = dir.join(executable);
    if candidate.is_file() {
        return Some(candidate);
    }
    #[cfg(windows)]
    {
        let exe = dir.join(format!("{executable}.exe"));
        if exe.is_file() {
            return Some(exe);
        }
        let cmd = dir.join(format!("{executable}.cmd"));
        if cmd.is_file() {
            return Some(cmd);
        }
    }
    None
}

fn path_sep() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

/// 把常见 Cursor CLI 安装目录插到 PATH 前面，便于 goose sidecar 找到 `agent`。
fn augmented_path() -> Option<String> {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();

    for dir in candidate_dirs() {
        if !dir.is_dir() {
            continue;
        }
        let text = dir.to_string_lossy().to_string();
        if path_contains(&current, &text) || parts.iter().any(|part| part == &text) {
            continue;
        }
        if dir_has_agent(&dir) {
            parts.push(text);
        }
    }

    if let Some((binary, _)) = find_agent_binary() {
        if let Some(parent) = binary.parent() {
            let text = parent.to_string_lossy().to_string();
            if !path_contains(&current, &text) && !parts.iter().any(|part| part == &text) {
                parts.push(text);
            }
        }
    }

    if parts.is_empty() {
        return if current.is_empty() {
            None
        } else {
            Some(current)
        };
    }

    parts.push(current);
    Some(parts.join(path_sep()))
}

fn path_contains(path_var: &str, dir: &str) -> bool {
    std::env::split_paths(path_var).any(|entry| entry.to_string_lossy().eq_ignore_ascii_case(dir))
}

fn dir_has_agent(dir: &Path) -> bool {
    agent_names()
        .iter()
        .any(|name| find_in_dir(dir, name).is_some())
}

fn run_status(binary: &Path) -> Result<String, String> {
    let mut command = Command::new(binary);
    command.arg("status");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|error| format!("无法执行 {} status：{error}", binary.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}").trim().to_string();

    if combined.is_empty() {
        if output.status.success() {
            Ok("agent status 成功（无输出）".into())
        } else {
            Err(format!(
                "agent status 失败（exit={}）",
                output.status.code().unwrap_or(-1)
            ))
        }
    } else if output.status.success() {
        Ok(combined)
    } else {
        Err(combined)
    }
}

fn is_authenticated_output(text: &str) -> bool {
    if looks_unauthenticated(text) {
        return false;
    }
    !text.trim().is_empty()
}

fn looks_unauthenticated(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("not authenticated")
        || lower.contains("not logged in")
        || lower.contains("please run")
        || lower.contains("login required")
        || lower.contains("unauthenticated")
}

fn truncate_detail(text: &str) -> String {
    const MAX: usize = 400;
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX {
        return trimmed.to_string();
    }
    let short: String = trimmed.chars().take(MAX).collect();
    format!("{short}…")
}
