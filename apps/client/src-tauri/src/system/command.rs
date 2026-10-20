use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::utils::goose_serve::{self, GooseConnection, GooseServeState};
use crate::utils::ipc;
use crate::utils::sidecar::{self, SIDECAR_SHUTDOWN_TIMEOUT, SidecarState};

const ALLOWED_MODULES: &[&str] = &["morph", "capture", "scan", "file"];

#[derive(Debug, Deserialize, Serialize)]
pub struct Memory {
    total: u64,
    used: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Swap {
    total: u64,
    used: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Cpu {
    brand: String,
    frequency: u64,
    cores: usize,
    arch: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OsContext {
    #[serde(rename = "OS")]
    pub os: String,
    pub version: String,
    pub kernel: String,
    pub hostname: String,
    #[serde(rename = "CPU")]
    pub cpu: Cpu,
    pub memory: Memory,
    pub swap: Swap,
}

#[tauri::command(rename = "system:greet")]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command(rename = "system:os")]
pub fn os() -> Result<OsContext, String> {
    let resp = ipc::invoke("scan", json!({ "Os": {} }))?;
    if !resp.ok {
        return Err(resp.error.unwrap_or_else(|| "scan Os 失败".to_string()));
    }
    let data = resp.data.ok_or_else(|| "scan 未返回 data".to_string())?;
    serde_json::from_value(data).map_err(|e| format!("解析 OsContext 失败: {e}"))
}

/// `None` = 启动中；`Some(true/false)` = 已结束。以管道连通性为准。
#[tauri::command(rename = "ipc:ready")]
pub fn ipc_ready(state: tauri::State<'_, SidecarState>) -> Option<bool> {
    if state.probe() {
        return Some(true);
    }
    state.status()
}

#[tauri::command(rename = "ipc:invoke")]
pub async fn ipc_invoke(
    module: String,
    args: serde_json::Value,
    action: Option<String>,
) -> Result<ipc::IpcResponse, String> {
    if !ALLOWED_MODULES.contains(&module.as_str()) {
        return Err(format!("IPC 模块不允许: {module}"));
    }
    if let Some(ref act) = action {
        if act.contains('.') {
            return Err("IPC action 不得包含 '.'".into());
        }
    }
    tokio::task::spawn_blocking(move || ipc::invoke_with(&module, action.as_deref(), args))
        .await
        .map_err(|e| format!("IPC 线程异常: {e}"))?
}

/// 从前端控制托盘图标徽章状态
#[tauri::command(rename = "tray:update-badge")]
pub fn tray_set_badge(app: tauri::AppHandle, has_badge: bool) {
    crate::ui::tray::set_badge(&app, has_badge);
}

/// 停止 corex-daemon 并等待进程退出（更新安装前调用）。
///
/// 超时仍返回 `Ok`，由 NSIS PREINSTALL hook 兜底，避免卡死更新。
#[tauri::command(rename = "sidecar:shutdown")]
pub async fn sidecar_shutdown(app: tauri::AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let _ = sidecar::shutdown_and_wait(&app, SIDECAR_SHUTDOWN_TIMEOUT);
    })
    .await
    .map_err(|e| format!("sidecar shutdown 线程异常: {e}"))?;
    Ok(())
}

/// `None` = 启动中；`Some(true/false)` = 已结束。
#[tauri::command(rename = "goose:ready")]
pub fn goose_ready(state: tauri::State<'_, GooseServeState>) -> Option<bool> {
    if state.is_ready() {
        return Some(true);
    }
    state.status()
}

#[tauri::command(rename = "goose:connection")]
pub fn goose_connection(
    state: tauri::State<'_, GooseServeState>,
) -> Result<GooseConnection, String> {
    state
        .connection()
        .ok_or_else(|| "goose serve 未就绪".to_string())
}

#[tauri::command(rename = "goose:shutdown")]
pub async fn goose_shutdown(app: tauri::AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        goose_serve::shutdown(&app);
    })
    .await
    .map_err(|e| format!("goose shutdown 线程异常: {e}"))?;
    Ok(())
}

#[tauri::command(rename = "goose:restart")]
pub async fn goose_restart(app: tauri::AppHandle) -> Result<(), String> {
    goose_serve::restart(&app).await
}

/// 登录/刷新令牌时，把 JWT 原子写到 `<appData>/cogito/jwt`，供 goose 的 token helper 读取。
#[tauri::command(rename = "cogito:token:write")]
pub fn cogito_token_write(app: tauri::AppHandle, token: String) -> Result<(), String> {
    crate::utils::cogito_token::write_jwt(&app, &token)
}

/// 退出登录时清掉 JWT 文件。
#[tauri::command(rename = "cogito:token:clear")]
pub fn cogito_token_clear(app: tauri::AppHandle) -> Result<(), String> {
    crate::utils::cogito_token::clear_jwt(&app)
}

/// 幂等注册 cogito 网关 provider：写声明式 JSON，有变化才重启 goose。返回是否重启过。
#[tauri::command(rename = "cogito:provider:ensure")]
pub async fn cogito_provider_ensure(
    app: tauri::AppHandle,
    tenant_id: String,
    base_url: String,
    models: Vec<String>,
) -> Result<bool, String> {
    crate::utils::cogito_provider::ensure_provider(&app, &tenant_id, &base_url, &models).await
}

/// 租户切换：只更新 provider 的 `X-Tenant-ID` 头，必要时重启 goose。返回是否重启过。
#[tauri::command(rename = "cogito:provider:set-tenant")]
pub async fn cogito_provider_set_tenant(
    app: tauri::AppHandle,
    tenant_id: String,
) -> Result<bool, String> {
    crate::utils::cogito_provider::set_tenant(&app, &tenant_id).await
}
