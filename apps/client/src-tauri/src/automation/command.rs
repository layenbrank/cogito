//! 定时任务 IPC。
//!
//! 放在 app 侧而不是 `cogito-command`：`owner=goose` 需要拉起 goose 子进程（shell 插件只在
//! 这一层），而 DB 侧仍然是同一个 `core::automation::Service`。
//!
//! 同步语义：先落库，再同步给 goose；goose 失败**不回滚**本地任务（用户能看到原因并重试），
//! 失败原因写进 `lastError`。

use cogito_core::CommandResult;
use cogito_core::automation::service::{
    AutomationInput, DueRun, FinishInput, PatchRunInput, Service,
};
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
    if let Ok(Some(model)) = Service::toGet(state.connection(), id.clone()).await
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
    let model = Service::toGet(state.connection(), id.clone())
        .await?
        .ok_or_else(|| cogito_core::Exception::NotFound(format!("任务不存在：{id}")))?;

    if model.owner == "goose" {
        GooseSchedule::run_now(&app, &model.id)
            .await
            .map_err(cogito_core::Exception::Internal)?;
        return Ok(None);
    }
    Service::toRunNow(state.connection(), id).await.map(Some)
}

#[tauri::command(rename = "automation:touchRun")]
pub async fn automation_touch_run(
    state: State<'_, Storage>,
    runId: String,
) -> CommandResult<RunModel> {
    Service::toTouchRun(state.connection(), runId).await
}

#[tauri::command(rename = "automation:finishRun")]
pub async fn automation_finish_run(
    state: State<'_, Storage>,
    input: FinishInput,
) -> CommandResult<RunModel> {
    Service::toFinish(state.connection(), input).await
}

#[tauri::command(rename = "automation:patchRun")]
pub async fn automation_patch_run(
    state: State<'_, Storage>,
    input: PatchRunInput,
) -> CommandResult<RunModel> {
    Service::toPatchRun(state.connection(), input).await
}

#[tauri::command(rename = "automation:runs")]
pub async fn automation_runs(
    state: State<'_, Storage>,
    // 省略 = 跨任务取最近 N 条（任务页的「全部记录」）
    automationId: Option<String>,
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
        // 从 goose 改成别的执行方：goose 侧那条排期得删掉，否则两边都跑（双发通知、双写副作用）
        if model.remoteId.is_some() {
            if let Err(error) = GooseSchedule::remove(app, &model.id).await {
                tracing::warn!("automation: 清理 goose 残留排期失败: {error}");
            }
            let _ = Service::toSetRemote(state.connection(), model.id.clone(), None, None).await;
        }
        return Ok(());
    }
    let result = if model.enabled {
        GooseSchedule::upsert(app, model).await
    } else {
        GooseSchedule::remove(app, &model.id).await
    };
    // 成功就把上一次的失败原因清掉
    if result.is_ok() {
        let _ = Service::toSetRemote(
            state.connection(),
            model.id.clone(),
            remote_id_of(model),
            None,
        )
        .await;
    }
    result
}
