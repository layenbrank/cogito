use cogito_core::CommandResult;
use cogito_core::magnetic_tile::Service;
use cogito_database::Storage;
use cogito_database::entity::magnetic_tile::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "magnetic-tile:write")]
pub async fn magnetic_tile_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "magnetic-tile:read")]
pub async fn magnetic_tile_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "magnetic-tile:update")]
pub async fn magnetic_tile_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "magnetic-tile:remove")]
pub async fn magnetic_tile_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
