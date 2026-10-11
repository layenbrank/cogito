//! corex-daemon 指令编排 IPC（短连接 `call` / `call_stream`）。

use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;

use crate::utils::ipc;
use crate::utils::sidecar::{
    self, SidecarState, corex_data_dir, corex_database_path,
};

const SIDECAR_PROGRESS_EVENT: &str = "sidecar:progress";

#[derive(Debug, Deserialize)]
pub struct SidecarRunInput {
    pub name: String,
    #[serde(default)]
    pub input: Option<Value>,
    #[serde(rename = "runId")]
    pub run_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SidecarInvokeInput {
    pub action: String,
    #[serde(default)]
    pub params: Option<Value>,
    #[serde(rename = "runId")]
    pub run_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SidecarDirectiveName {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct SidecarSaveDirective {
    pub definition: Value,
    #[serde(default)]
    pub original_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SidecarImportDirectives {
    pub path: String,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub is_overwrite: Option<bool>,
    #[serde(default)]
    pub is_dry_run: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SidecarListRuns {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct SidecarValidate {
    pub definition: Value,
    #[serde(default)]
    pub strict: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SidecarCancelExecution {
    pub target_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct SidecarJobsQuery {
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SidecarStartJob {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub immediate: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SidecarStopJob {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub force: Option<bool>,
}

fn parse_job_kind(kind: &str) -> Result<&str, String> {
    match kind {
        "cron" | "watch" => Ok(kind),
        other => Err(format!("作业类型不合法：{other}（仅支持 cron / watch）")),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub is_ready: bool,
    pub version: String,
    pub actions: Vec<String>,
    pub has_corex: bool,
    pub data_dir: String,
    pub database: String,
    pub is_bundled: bool,
}

fn ensure_sidecar(state: &SidecarState) -> Result<(), String> {
    if state.probe() {
        return Ok(());
    }
    if state.status().is_some() {
        return Err("corex-daemon 未就绪".into());
    }
    Err("corex-daemon 仍在启动".into())
}

fn is_valid_directive_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('\\') && !name.contains('/') && !name.contains("..")
}

fn find_corex_cli() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("COREX_CLI") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    #[cfg(windows)]
    {
        if let Ok(path_var) = std::env::var("PATH") {
            for entry in path_var.split(';') {
                if entry.is_empty() {
                    continue;
                }
                let candidate = PathBuf::from(entry).join("corex.exe");
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            for sub in ["corex\\bin\\corex.exe", "corex\\corex.exe"] {
                let candidate = PathBuf::from(&local).join(sub);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let candidate = PathBuf::from(pf).join("corex").join("corex.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err("未找到 corex CLI：请安装 corex 或设置 COREX_CLI".into())
}

#[tauri::command(rename = "sidecar:toRead")]
pub fn sidecar_to_read(app: AppHandle, state: tauri::State<'_, SidecarState>) -> SidecarStatus {
    let data_dir = corex_data_dir(&app).unwrap_or_default();
    let database = corex_database_path(&data_dir);
    let is_ready = state.probe();
    let mut actions = Vec::new();
    if is_ready {
        if let Ok(data) = ipc::call("list_actions", json!({})) {
            actions = parse_action_ids(&data);
        }
    }
    SidecarStatus {
        is_ready,
        version: String::new(),
        actions,
        has_corex: true,
        data_dir: data_dir.to_string_lossy().into_owned(),
        database: database.to_string_lossy().into_owned(),
        is_bundled: true,
    }
}

fn parse_action_ids(data: &Value) -> Vec<String> {
    if let Some(items) = data.as_array() {
        return items
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
            .collect();
    }
    data.get("actions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command(rename = "sidecar:actions")]
pub async fn sidecar_actions(state: tauri::State<'_, SidecarState>) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let data = tokio::task::spawn_blocking(|| ipc::call("list_actions", json!({})))
        .await
        .map_err(|e| format!("sidecar actions 线程异常: {e}"))??;
    // daemon 回 `{ version, count, actions: [...] }`；前端契约是动作数组
    Ok(data
        .get("actions")
        .cloned()
        .unwrap_or_else(|| {
            if data.is_array() {
                data
            } else {
                json!([])
            }
        }))
}

#[tauri::command(rename = "sidecar:directives")]
pub async fn sidecar_directives(state: tauri::State<'_, SidecarState>) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    tokio::task::spawn_blocking(|| ipc::call("directives", json!({})))
        .await
        .map_err(|e| format!("sidecar directives 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:directive")]
pub async fn sidecar_directive(
    state: tauri::State<'_, SidecarState>,
    input: SidecarDirectiveName,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let name = input.name;
    tokio::task::spawn_blocking(move || ipc::call("read_directive", json!({ "name": name })))
        .await
        .map_err(|e| format!("sidecar directive 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:saveDirective")]
pub async fn sidecar_save_directive(
    state: tauri::State<'_, SidecarState>,
    input: SidecarSaveDirective,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let name = input
        .definition
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "definition.name 不能为空".to_string())?
        .to_string();
    let mut fields = json!({
        "name": name,
        "definition": input.definition,
    });
    if let Some(original) = input.original_name.filter(|o| o != &name) {
        fields["original_name"] = json!(original);
    }
    tokio::task::spawn_blocking(move || ipc::call("save_directive", fields))
        .await
        .map_err(|e| format!("sidecar saveDirective 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:deleteDirective")]
pub async fn sidecar_delete_directive(
    state: tauri::State<'_, SidecarState>,
    input: SidecarDirectiveName,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let name = input.name;
    tokio::task::spawn_blocking(move || ipc::call("delete_directive", json!({ "name": name })))
        .await
        .map_err(|e| format!("sidecar deleteDirective 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:importDirectives")]
pub async fn sidecar_import_directives(
    state: tauri::State<'_, SidecarState>,
    input: SidecarImportDirectives,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let mut fields = json!({ "path": input.path });
    if let Some(folder) = input.folder {
        fields["folder"] = json!(folder);
    }
    if let Some(is_overwrite) = input.is_overwrite {
        fields["is_overwrite"] = json!(is_overwrite);
    }
    if let Some(is_dry_run) = input.is_dry_run {
        fields["is_dry_run"] = json!(is_dry_run);
    }
    tokio::task::spawn_blocking(move || ipc::call("import_directives", fields))
        .await
        .map_err(|e| format!("sidecar importDirectives 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:editDirective")]
pub async fn sidecar_edit_directive(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
    input: SidecarDirectiveName,
) -> Result<(), String> {
    ensure_sidecar(&state)?;
    if !is_valid_directive_name(&input.name) {
        return Err(format!("指令名不合法：{}", input.name));
    }
    let name = input.name;
    tokio::task::spawn_blocking(move || spawn_corex_edit(&app, &name))
        .await
        .map_err(|e| format!("sidecar editDirective 线程异常: {e}"))??;
    Ok(())
}

fn spawn_corex_edit(app: &AppHandle, name: &str) -> Result<(), String> {
    let cli = find_corex_cli()?;
    let data_dir = corex_data_dir(app)?;
    Command::new(&cli)
        .args(["edit", name])
        .env(sidecar::COREX_DATA_DIR_ENV, data_dir.to_string_lossy().as_ref())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 corex edit 失败: {e}"))?;
    Ok(())
}

#[tauri::command(rename = "sidecar:run")]
pub async fn sidecar_run(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
    input: SidecarRunInput,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    if input.run_id.trim().is_empty() {
        return Err("runId 不能为空".into());
    }
    let name = input.name;
    let run_id = input.run_id;
    let mut fields = json!({ "name": name });
    if let Some(input_map) = input.input {
        fields["input"] = input_map;
    }
    tokio::task::spawn_blocking(move || {
        ipc::call_stream(
            &app,
            SIDECAR_PROGRESS_EVENT,
            &run_id,
            "run_directive",
            fields,
        )
    })
    .await
    .map_err(|e| format!("sidecar run 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:invoke")]
pub async fn sidecar_invoke(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
    input: SidecarInvokeInput,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    if input.run_id.trim().is_empty() {
        return Err("runId 不能为空".into());
    }
    if input.action.trim().is_empty() {
        return Err("action 不能为空".into());
    }
    let action = input.action;
    let run_id = input.run_id;
    let fields = json!({
        "action": action,
        "params": input.params.unwrap_or_else(|| json!({})),
    });
    tokio::task::spawn_blocking(move || {
        ipc::call_stream(
            &app,
            SIDECAR_PROGRESS_EVENT,
            &run_id,
            "invoke",
            fields,
        )
    })
    .await
    .map_err(|e| format!("sidecar invoke 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:listRuns")]
pub async fn sidecar_list_runs(
    state: tauri::State<'_, SidecarState>,
    input: SidecarListRuns,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let mut fields = json!({});
    if let Some(name) = input.name {
        fields["name"] = json!(name);
    }
    if let Some(limit) = input.limit {
        fields["limit"] = json!(limit);
    }
    tokio::task::spawn_blocking(move || ipc::call("list_runs", fields))
        .await
        .map_err(|e| format!("sidecar listRuns 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:validate")]
pub async fn sidecar_validate(
    state: tauri::State<'_, SidecarState>,
    input: SidecarValidate,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let mut fields = json!({ "definition": input.definition });
    if let Some(strict) = input.strict {
        fields["strict"] = json!(strict);
    }
    tokio::task::spawn_blocking(move || ipc::call("validate_directive", fields))
        .await
        .map_err(|e| format!("sidecar validate 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:cancelExecution")]
pub async fn sidecar_cancel_execution(
    state: tauri::State<'_, SidecarState>,
    input: SidecarCancelExecution,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let target_id = input.target_id;
    tokio::task::spawn_blocking(move || {
        ipc::call("cancel_execution", json!({ "target_id": target_id }))
    })
    .await
    .map_err(|e| format!("sidecar cancelExecution 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:jobs")]
pub async fn sidecar_jobs(
    state: tauri::State<'_, SidecarState>,
    input: SidecarJobsQuery,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    let mut fields = json!({});
    if let Some(kind) = input.kind.as_deref() {
        let kind = parse_job_kind(kind)?;
        fields["kind"] = json!(kind);
    }
    tokio::task::spawn_blocking(move || ipc::call("jobs", fields))
        .await
        .map_err(|e| format!("sidecar jobs 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:startJob")]
pub async fn sidecar_start_job(
    state: tauri::State<'_, SidecarState>,
    input: SidecarStartJob,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    if !is_valid_directive_name(&input.name) {
        return Err(format!("指令名不合法：{}", input.name));
    }
    let kind = parse_job_kind(&input.kind)?.to_string();
    let name = input.name;
    let mut fields = json!({ "kind": kind, "name": name });
    if let Some(immediate) = input.immediate {
        fields["immediate"] = json!(immediate);
    }
    tokio::task::spawn_blocking(move || ipc::call("start_job", fields))
        .await
        .map_err(|e| format!("sidecar startJob 线程异常: {e}"))?
}

#[tauri::command(rename = "sidecar:stopJob")]
pub async fn sidecar_stop_job(
    state: tauri::State<'_, SidecarState>,
    input: SidecarStopJob,
) -> Result<Value, String> {
    ensure_sidecar(&state)?;
    if !is_valid_directive_name(&input.name) {
        return Err(format!("指令名不合法：{}", input.name));
    }
    let kind = parse_job_kind(&input.kind)?.to_string();
    let name = input.name;
    let mut fields = json!({ "kind": kind, "name": name });
    if let Some(force) = input.force {
        fields["force"] = json!(force);
    }
    tokio::task::spawn_blocking(move || ipc::call("stop_job", fields))
        .await
        .map_err(|e| format!("sidecar stopJob 线程异常: {e}"))?
}
