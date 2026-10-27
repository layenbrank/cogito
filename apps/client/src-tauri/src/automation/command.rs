//! 定时任务 IPC。
//!
//! 放在 app 侧而不是 `cogito-command`：`owner=goose` 需要拉起 goose 子进程（shell 插件只在
//! 这一层），而 DB 侧仍然是同一个 `core::automation::Service`。
//!
//! 同步语义：先落库，再同步给 goose；goose 失败**不回滚**本地任务（用户能看到原因并重试），
//! 失败原因写进 `lastError`。

use cogito_core::CommandResult;
use cogito_core::automation::service::{AutomationInput, DueRun, FinishInput, Service};
use cogito_database::Storage;
use cogito_database::entity::automation::Model;
use cogito_database::entity::automation_run::Model as RunModel;
use tauri::{AppHandle, State};

use crate::automation::goose::GooseSchedule;

#[tauri::command(rename = "automation:save")]
pub async fn automation_save(
    app: AppHandle,
    state: State<'_, Storage>,
    input: AutomationInput,
) -> CommandResult<Model> {
    let model = Service::toSave(state.connection(), input).await?;
    match sync(&app, &state, &model).await {
        Ok(()) => Ok(model),
        // 同步失败也要把任务交回前端：本地这一行是有效的，只是远端没建上
        Err(error) => {
            tracing::warn!("automation: 同步 goose 失败: {error}");
            Service::toSetRemote(
                state.connection(),
                model.id.clone(),
                remote_id_of(&model),
                Some(error),
            )
            .await
        }
    }
}

#[tauri::command(rename = "automation:list")]
pub async fn automation_list(state: State<'_, Storage>) -> CommandResult<Vec<Model>> {
    Service::toList(state.connection()).await
}

#[tauri::command(rename = "automation:setEnabled")]
pub async fn automation_set_enabled(
    app: AppHandle,
    state: State<'_, Storage>,
    id: String,
    enabled: bool,
) -> CommandResult<Model> {
    let model = Service::toSetEnabled(state.connection(), id, enabled).await?;
    let error = sync(&app, &state, &model).await.err();
    Service::toSetRemote(
        state.connection(),
        model.id.clone(),
        remote_id_of(&model),
        error,
    )
    .await
}

#[tauri::command(rename = "automation:remove")]
pub async fn automation_remove(
    app: AppHandle,
    state: State<'_, Storage>,
    id: String,
) -> CommandResult<u64> {
    // 先删远端再删本地：删本地后就没法知道它是不是 goose 管的了
    if let Ok(Some(model)) = Service::toList(state.connection())
        .await
        .map(|items| items.into_iter().find(|item| item.id == id))
        && model.owner == "goose"
    {
        if let Err(error) = GooseSchedule::remove(&app, &model.id).await {
            tracing::warn!("automation: 移除 goose 任务失败: {error}");
        }
    }
    Service::toRemove(state.connection(), id).await
}

/// 返回 `None` 表示这次执行交给了 goose（本地没有执行记录，记录在 goose 侧）。
#[tauri::command(rename = "automation:runNow")]
pub async fn automation_run_now(
    app: AppHandle,
    state: State<'_, Storage>,
    id: String,
) -> CommandResult<Option<DueRun>> {
    let items = Service::toList(state.connection()).await?;
    let model = items
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| cogito_core::Exception::NotFound(format!("任务不存在：{id}")))?;

    if model.owner == "goose" {
        GooseSchedule::run_now(&app, &model.id)
            .await
            .map_err(cogito_core::Exception::Internal)?;
        return Ok(None);
    }
    Service::toRunNow(state.connection(), id).await.map(Some)
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

/// 只有 goose 管的任务需要有远端 id：schedule-id 直接用本地任务 id，便于两边对照
fn remote_id_of(model: &Model) -> Option<String> {
    if model.owner == "goose" {
        Some(model.id.clone())
    } else {
        None
    }
}

/// 把任务同步到 goose：启用的建/刷，停用的删；非 goose 任务什么都不做
async fn sync(app: &AppHandle, state: &State<'_, Storage>, model: &Model) -> Result<(), String> {
    if model.owner != "goose" {
        return Ok(());
    }
    let result = if model.enabled {
        GooseSchedule::upsert(app, model).await
    } else {
        GooseSchedule::remove(app, &model.id).await
    };
    // 成功就把上一次的失败原因清掉
    if result.is_ok() {
        let _ = Service::toSetRemote(state.connection(), model.id.clone(), remote_id_of(model), None)
            .await;
    }
    result
}
