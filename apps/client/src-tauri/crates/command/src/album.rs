use tauri::State;
use thinking_core::CommandResult;
use thinking_core::album::Service;
use thinking_database::Storage;
use thinking_database::entity::album::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "album:write")]
pub async fn album_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "album:read")]
pub async fn album_read(state: State<'_, Storage>, params: ReadP) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "album:update")]
pub async fn album_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "album:remove")]
pub async fn album_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
