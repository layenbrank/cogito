use tauri::State;
use thinking_core::CommandResult;
use thinking_core::signboard_column::Service;
use thinking_database::Storage;
use thinking_database::entity::signboard_column::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "signboard-column:write")]
pub async fn signboard_column_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-column:read")]
pub async fn signboard_column_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-column:update")]
pub async fn signboard_column_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-column:remove")]
pub async fn signboard_column_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
