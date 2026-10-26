//! 指令草稿 IPC：pending 草稿的新增/列出/确认/丢弃
use tauri::State;
use thinking_core::CommandResult;
use thinking_core::directive_draft::{DraftInput, DraftStatusInput, Service};
use thinking_database::Storage;
use thinking_database::entity::directive_draft::Model;

#[tauri::command(rename = "directiveDraft:save")]
pub async fn directive_draft_save(
    state: State<'_, Storage>,
    input: DraftInput,
) -> CommandResult<Model> {
    Service::toSave(state.connection(), input).await
}

#[tauri::command(rename = "directiveDraft:list")]
pub async fn directive_draft_list(
    state: State<'_, Storage>,
    status: Option<String>,
    limit: Option<u64>,
) -> CommandResult<Vec<Model>> {
    Service::toList(state.connection(), status, limit).await
}

#[tauri::command(rename = "directiveDraft:setStatus")]
pub async fn directive_draft_set_status(
    state: State<'_, Storage>,
    input: DraftStatusInput,
) -> CommandResult<Model> {
    Service::toSetStatus(state.connection(), input).await
}

#[tauri::command(rename = "directiveDraft:remove")]
pub async fn directive_draft_remove(state: State<'_, Storage>, id: String) -> CommandResult<u64> {
    Service::toRemove(state.connection(), id).await
}
