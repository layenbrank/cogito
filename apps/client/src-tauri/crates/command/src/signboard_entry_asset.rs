use cogito_core::CommandResult;
use cogito_core::signboard_entry_asset::Service;
use cogito_database::Storage;
use cogito_database::entity::signboard_entry_asset::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "signboard-entry-asset:write")]
pub async fn signboard_entry_asset_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-entry-asset:read")]
pub async fn signboard_entry_asset_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-entry-asset:update")]
pub async fn signboard_entry_asset_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-entry-asset:remove")]
pub async fn signboard_entry_asset_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
