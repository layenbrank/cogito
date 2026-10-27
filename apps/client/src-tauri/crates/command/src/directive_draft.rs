//! 指令草稿 IPC：pending 草稿的新增/列出/确认/丢弃
use cogito_core::CommandResult;
use cogito_core::directive_draft::{DraftInput, DraftStatusInput, Service};
use cogito_database::Storage;
use cogito_database::entity::directive_draft::Model;
use tauri::State;

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
