use cogito_core::CommandResult;
use cogito_core::bookmark::Service;
use cogito_database::Storage;
use cogito_database::entity::bookmark::{ImportP, ImportR, Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "bookmark:write")]
pub async fn bookmark_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "bookmark:read")]
pub async fn bookmark_read(state: State<'_, Storage>, params: ReadP) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "bookmark:update")]
pub async fn bookmark_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "bookmark:remove")]
pub async fn bookmark_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}

#[tauri::command(rename = "bookmark:import")]
pub async fn bookmark_import(state: State<'_, Storage>, params: ImportP) -> CommandResult<ImportR> {
    Service::toImport(state.connection(), params).await
}
