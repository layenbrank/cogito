//! 定时任务 IPC：定义维护 + 手动执行 + 执行记录。
//!
//! 执行结果由**前端**回写（会话只能在 WebView 里跑），所以这里只提供
//! `runNow` / `finishRun` 两个入口，不在 Rust 侧直接跑任务。
use cogito_core::CommandResult;
use cogito_core::automation::service::{AutomationInput, DueRun, FinishInput, Service};
use cogito_database::Storage;
use cogito_database::entity::automation::Model;
use cogito_database::entity::automation_run::Model as RunModel;
use tauri::State;

#[tauri::command(rename = "automation:save")]
pub async fn automation_save(
    state: State<'_, Storage>,
    input: AutomationInput,
) -> CommandResult<Model> {
    Service::toSave(state.connection(), input).await
}

#[tauri::command(rename = "automation:list")]
pub async fn automation_list(state: State<'_, Storage>) -> CommandResult<Vec<Model>> {
    Service::toList(state.connection()).await
}

#[tauri::command(rename = "automation:setEnabled")]
pub async fn automation_set_enabled(
    state: State<'_, Storage>,
    id: String,
    enabled: bool,
) -> CommandResult<Model> {
    Service::toSetEnabled(state.connection(), id, enabled).await
}

#[tauri::command(rename = "automation:remove")]
pub async fn automation_remove(state: State<'_, Storage>, id: String) -> CommandResult<u64> {
    Service::toRemove(state.connection(), id).await
}

#[tauri::command(rename = "automation:runNow")]
pub async fn automation_run_now(state: State<'_, Storage>, id: String) -> CommandResult<DueRun> {
    Service::toRunNow(state.connection(), id).await
}

#[tauri::command(rename = "automation:finishRun")]
pub async fn automation_finish_run(
    state: State<'_, Storage>,
    input: FinishInput,
) -> CommandResult<RunModel> {
    Service::toFinish(state.connection(), input).await
}

#[tauri::command(rename = "automation:runs")]
pub async fn automation_runs(
    state: State<'_, Storage>,
    automationId: String,
    limit: Option<u64>,
) -> CommandResult<Vec<RunModel>> {
    Service::toListRuns(state.connection(), automationId, limit).await
}
