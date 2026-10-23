//! cogito 网关 provider 的声明式注册（方案 A：直接写 goose 的 `custom_providers` JSON）。
//!
//! goose 1.54 的 ACP `_goose/unstable/providers/custom/create` 不暴露 `auth.command`（只有
//! `apiKey`），所以不走 ACP，改为直接写 `<goose-config>/custom_providers/cogito_gateway.json`。
//! goose 每次启动/重启都会扫描该目录（`register_declarative_providers`），写完后
//! `goose_serve::restart` 让 goose 重读。
//!
//! 鉴权：`auth.command` 指向主程序自身（`cogito --token-helper --file <jwt>`），helper
//! 每次读 `<appData>/cogito/jwt` 输出令牌（登录/刷新时由 `cogito_token` 原子落盘）。
//! goose 会把它拼成 `Authorization: Bearer <token>` 打到网关，与渲染进程一致。
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::utils::cogito_token;

const PROVIDER_ID: &str = "cogito_gateway";
const PROVIDER_FILE: &str = "cogito_gateway.json";
/// 令牌缓存时长（秒）：小于服务端 JWT TTL，过期前 goose 重跑 helper 拿新令牌。
const REFRESH_INTERVAL_SECS: u64 = 120;
/// 网关 completions 路径（前端只能传完整 URL，Rust 侧强制校验路径，防 JWT 被导向任意主机）
const GATEWAY_CHAT_PATH: &str = "/api/v1/gateway/chat/completions";

/// 校验前端传入的网关 URL：https（或本机 http）+ 精确 completions 路径，禁止 userinfo。
fn validate_gateway_base_url(base_url: &str) -> Result<(), String> {
    let parsed = Url::parse(base_url).map_err(|e| format!("网关 URL 无效: {e}"))?;
    match parsed.scheme() {
        "https" => {}
        "http" => {
            let host = parsed.host_str().unwrap_or("");
            if host != "localhost" && host != "127.0.0.1" && host != "::1" {
                return Err("非本机网关必须使用 https".to_string());
            }
        }
        _ => return Err("网关 URL 只允许 http/https".to_string()),
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("网关 URL 不允许携带用户名/密码".to_string());
    }
    let path = parsed.path().trim_end_matches('/');
    if path != GATEWAY_CHAT_PATH {
        return Err(format!("网关 URL 路径必须是 {GATEWAY_CHAT_PATH}"));
    }
    Ok(())
}

fn custom_providers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(base.join("goose").join("config").join("custom_providers"))
}

fn provider_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(custom_providers_dir(app)?.join(PROVIDER_FILE))
}

/// token helper 就是主程序自身；`--token-helper` 子命令在 `main.rs` 里读文件输出令牌。
fn token_helper_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("获取当前可执行文件路径失败: {e}"))
}

fn build_provider_json(
    app: &AppHandle,
    tenant_id: &str,
    base_url: &str,
    models: &[String],
) -> Result<Value, String> {
    let jwt_path = cogito_token::cogito_jwt_path(app)?;
    let helper = token_helper_path()?;
    Ok(json!({
        "name": PROVIDER_ID,
        "engine": "openai",
        "display_name": "Cogito Gateway",
        "base_url": base_url,
        "models": models.iter().map(|m| json!({ "name": m })).collect::<Vec<_>>(),
        "headers": { "X-Tenant-ID": tenant_id },
        "requires_auth": true,
        "supports_streaming": true,
        "preserves_thinking": true,
        "auth": {
            "command": helper,
            "args": ["--token-helper", "--file", jwt_path.to_string_lossy().as_ref()],
            "refresh_interval": REFRESH_INTERVAL_SECS
        }
    }))
}

fn write_provider_json(app: &AppHandle, value: &Value) -> Result<(), String> {
    let path = provider_file_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| "provider 文件路径没有父目录".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建 custom_providers 目录失败: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    {
        let mut file =
            fs::File::create(&tmp).map_err(|e| format!("创建 provider 临时文件失败: {e}"))?;
        let content = serde_json::to_string_pretty(value)
            .map_err(|e| format!("序列化 provider JSON 失败: {e}"))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("写入 provider 失败: {e}"))?;
        file.flush()
            .map_err(|e| format!("flush provider 失败: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("原子替换 provider 失败: {e}"))?;
    Ok(())
}

fn read_provider_json(app: &AppHandle) -> Option<Value> {
    let path = provider_file_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 幂等注册：JSON 与目标一致时不动；否则落盘并重启 goose 重读。返回是否发生了重启。
///
/// `force`：即使 JSON 已一致也重启 goose。用于「文件在、但当前 goose 进程没加载到
/// `cogito_gateway`」的裂隙（例如首次写入后重启失败，或 goose 早于文件启动）。
pub async fn ensure_provider(
    app: &AppHandle,
    tenant_id: &str,
    base_url: &str,
    models: &[String],
    force: bool,
) -> Result<bool, String> {
    validate_gateway_base_url(base_url)?;
    if tenant_id.trim().is_empty() {
        return Err("租户 id 不能为空".to_string());
    }
    if models.is_empty() {
        return Err("模型目录不能为空".to_string());
    }
    let target = build_provider_json(app, tenant_id, base_url, models)?;
    if !force {
        if let Some(existing) = read_provider_json(app) {
            if existing == target {
                return Ok(false);
            }
        }
    }
    write_provider_json(app, &target)?;
    crate::utils::goose_serve::restart(app).await?;
    Ok(true)
}

/// 租户切换：只改 `X-Tenant-ID`，其余（base_url / models / auth）保持原样。
pub async fn set_tenant(app: &AppHandle, tenant_id: &str) -> Result<bool, String> {
    let mut existing = match read_provider_json(app) {
        Some(v) => v,
        None => return Ok(false), // 还没注册过，无需处理
    };
    let current = existing
        .get("headers")
        .and_then(|h| h.get("X-Tenant-ID"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if current == tenant_id {
        return Ok(false);
    }
    if let Some(headers) = existing.get_mut("headers").and_then(|h| h.as_object_mut()) {
        headers.insert(
            "X-Tenant-ID".to_string(),
            Value::String(tenant_id.to_string()),
        );
    } else {
        existing["headers"] = json!({ "X-Tenant-ID": tenant_id });
    }
    write_provider_json(app, &existing)?;
    crate::utils::goose_serve::restart(app).await?;
    Ok(true)
}
