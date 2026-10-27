use cogito_core::CommandResult;
use cogito_core::asset::Service;
use cogito_database::Storage;
use cogito_database::entity::asset::{InsertP, InsertR, Model, ReadP, RemoveP, UpdateP};
use tauri::State;

#[tauri::command(rename = "asset:read")]
pub async fn asset_read(state: State<'_, Storage>, params: ReadP) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "asset:insert")]
pub async fn asset_insert(
    state: State<'_, Storage>,
    params: InsertP,
) -> CommandResult<Vec<InsertR>> {
    Service::toInsert(state.connection(), params).await
}

#[tauri::command(rename = "asset:update")]
pub async fn asset_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<InsertR>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "asset:remove")]
pub async fn asset_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
