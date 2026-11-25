//! 一次性 goose 子命令（`schedule add/remove/run-now` 这类）。
//!
//! 为什么还留着它：**调度任务的宿主仍是 goose 自己的 scheduler**（`automation/goose.rs`
//! 只做镜像），而那是「跑一次就退出」的命令，不适合塞进 agentd 的常驻 ACP 会话。
//!
//! 与 agentd 的分工：
//! - 常驻会话（对话）由 agentd 以 stdio ACP 托管；
//! - 一次性命令（调度维护）由这里直接 spawn，用完即退。
//!
//! 两者共用同一套「二进制解析 + `GOOSE_PATH_ROOT`」，所以 goose 的调度数据仍然落在
//! 应用自己的 `<appData>/goose` 下，不会和用户全局安装的 goose 混在一起。

use std::time::Duration;

use rand::RngCore;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tracing::{info, warn};

/// 一次性命令的兜底上限：调度维护都是毫秒级，超过这个值说明 goose 卡住了。
const RUN_TIMEOUT: Duration = Duration::from_secs(30);

/// 跑一次 goose 子命令并收集输出。
pub async fn run_goose(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    // 一次性命令不需要密钥，但 build 要一个值；用完即弃
    let token = random_token();
    let command = build_goose_command(app, args, &token)?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("启动 goose 失败: {e}"))?;

    // 宿主被强杀时不能留孤儿
    crate::utils::child_job::adopt(child.pid(), "goose");

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code: Option<i32> = None;
    let deadline = tokio::time::Instant::now() + RUN_TIMEOUT;
    loop {
        let event = tokio::select! {
            event = rx.recv() => event,
            _ = tokio::time::sleep_until(deadline) => {
                let _ = child.kill();
                return Err(format!("goose {} 超时（{:?}）", args.join(" "), RUN_TIMEOUT))
            }
        };
        let Some(event) = event else { break };
        match event {
            CommandEvent::Stdout(bytes) => stdout.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Stderr(bytes) => stderr.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(payload) => {
                code = payload.code;
                break;
            }
            _ => {}
        }
    }

    if code == Some(0) {
        Ok(stdout)
    } else {
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(format!(
            "goose {} 失败（exit={code:?}）：{detail}",
            args.join(" ")
        ))
    }
}

/// goose 的 config/data/state 根目录：`<appData>/goose`。
///
/// goose 读 `GOOSE_PATH_ROOT`（须绝对路径）后把 config 落到 `<root>/config`。这样
/// `custom_providers` 与用户全局的 goose 配置完全隔离，也让我们能确定地写声明式 provider。
pub fn goose_path_root(app: &AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(base.join("goose").to_string_lossy().to_string())
}

fn build_goose_command(
    app: &AppHandle,
    args: &[&str],
    token: &str,
) -> Result<tauri_plugin_shell::process::Command, String> {
    let path_root = goose_path_root(app)?;
    #[cfg(debug_assertions)]
    {
        if let Ok(path) = std::env::var("GOOSE_BINARY") {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                info!("使用 GOOSE_BINARY={trimmed}");
                let command = app
                    .shell()
                    .command(trimmed)
                    .args(args.iter().copied())
                    .env("GOOSE_SERVER__SECRET_KEY", token)
                    .env("GOOSE_PATH_ROOT", &path_root);
                return Ok(with_cli_envs(command));
            }
        }
    }

    let command = app
        .shell()
        .sidecar("goose")
        .map_err(|e| format!("创建 goose sidecar 失败: {e}"))?
        .args(args.iter().copied())
        .env("GOOSE_SERVER__SECRET_KEY", token)
        .env("GOOSE_PATH_ROOT", &path_root);
    Ok(with_cli_envs(command))
}

/// 注入侧车要继承的环境变量：Cursor CLI 的 PATH / CURSOR_API_KEY，
/// 以及**归一后的** `OLLAMA_HOST`（见 `normalize_ollama_host`）。
fn with_cli_envs(
    mut command: tauri_plugin_shell::process::Command,
) -> tauri_plugin_shell::process::Command {
    for (key, value) in crate::utils::cursor_agent::goose_cli_envs() {
        command = command.env(key, value);
    }
    if let Ok(raw) = std::env::var("OLLAMA_HOST") {
        if let Some(normalized) = normalize_ollama_host(&raw) {
            info!("OLLAMA_HOST 归一：{} → {}", raw.trim(), normalized);
            command = command.env("OLLAMA_HOST", normalized);
        }
    }
    command
}

/// 把 Ollama 的监听地址改成**能拨号**的地址。
///
/// 用户常把 `OLLAMA_HOST` 设成 `0.0.0.0`（那是服务端监听写法），而 goose 的 ollama
/// provider 拿它当**请求地址**，拼出 `http://0.0.0.0/v1/chat/completions`（无端口 = 80）
/// —— 本机一定连不上，还会被代理吞成 502。
///
/// 只改写两种情况：通配地址（`0.0.0.0` / `::` / `*`）和缺端口；其余原样透传（`None`）。
fn normalize_ollama_host(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    let (scheme, rest) = match text.split_once("://") {
        Some((scheme, rest)) => (Some(scheme), rest),
        None => (None, text),
    };
    let (host, port) = split_host_port(rest);
    let is_wildcard = matches!(host, "0.0.0.0" | "::" | "*");
    if !is_wildcard {
        // 能拨号（带端口）的行不动；IPv6 无端口不猜，免得拼出非法地址
        if port.is_some() || host.contains(':') {
            return None;
        }
    }
    let target_host = if is_wildcard { "127.0.0.1" } else { host };
    let target_port = port.unwrap_or("11434");
    Some(match scheme {
        Some(scheme) => format!("{scheme}://{target_host}:{target_port}"),
        None => format!("{target_host}:{target_port}"),
    })
}

/// `host:port` / `[::]:11434` / `[::]` / `host` 四种形态拆开；无端口时返回 `(host, None)`。
fn split_host_port(value: &str) -> (&str, Option<&str>) {
    if let Some(inner) = value.strip_prefix('[') {
        return match inner.split_once("]:") {
            Some((host, port)) => (host, Some(port)),
            None => (inner.strip_suffix(']').unwrap_or(inner), None),
        };
    }
    match value.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => (host, Some(port)),
        _ => (value, None),
    }
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// 归一化证书指纹（旧 wss 路径的遗留工具函数，保留给诊断输出用）。
pub fn normalize_fingerprint(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_hexdigit())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// 兼容旧调用点：`goose_serve::restart` 已并入 agentd（内层 goose 重启）。
pub async fn restart(app: &AppHandle) -> Result<(), String> {
    warn!("goose_cli::restart 已废弃，请调用 agentd::restart_goose");
    crate::utils::agentd::restart_goose(app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 通配地址是「监听」写法，当请求地址用时必须换成回环
    #[test]
    fn ollama_host_wildcard_becomes_loopback() {
        assert_eq!(
            normalize_ollama_host("0.0.0.0").as_deref(),
            Some("127.0.0.1:11434")
        );
        assert_eq!(
            normalize_ollama_host("0.0.0.0:11500").as_deref(),
            Some("127.0.0.1:11500")
        );
        assert_eq!(
            normalize_ollama_host("http://0.0.0.0:11434").as_deref(),
            Some("http://127.0.0.1:11434")
        );
        assert_eq!(
            normalize_ollama_host("[::]").as_deref(),
            Some("127.0.0.1:11434")
        );
    }

    /// 本来就能拨号的地址一律不改
    #[test]
    fn ollama_host_keeps_dialable_addresses() {
        assert_eq!(normalize_ollama_host("127.0.0.1:11434"), None);
        assert_eq!(normalize_ollama_host("http://192.168.1.9:11434"), None);
        assert_eq!(normalize_ollama_host(""), None);
    }

    #[test]
    fn fingerprint_is_normalized_to_lowercase_hex() {
        assert_eq!(normalize_fingerprint("AB:cd:EF 12"), "abcdef12");
    }
}
