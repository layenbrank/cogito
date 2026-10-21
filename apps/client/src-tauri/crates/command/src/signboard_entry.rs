use tauri::State;
use thinking_core::CommandResult;
use thinking_core::signboard_entry::Service;
use thinking_database::Storage;
use thinking_database::entity::signboard_entry::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "signboard-entry:write")]
pub async fn signboard_entry_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-entry:read")]
pub async fn signboard_entry_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-entry:update")]
pub async fn signboard_entry_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-entry:remove")]
pub async fn signboard_entry_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
