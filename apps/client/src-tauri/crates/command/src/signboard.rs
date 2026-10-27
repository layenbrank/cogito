use cogito_core::CommandResult;
use cogito_core::signboard::Service;
use cogito_database::Storage;
use cogito_database::entity::signboard::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "signboard:write")]
pub async fn signboard_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard:read")]
pub async fn signboard_read(state: State<'_, Storage>, params: ReadP) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard:update")]
pub async fn signboard_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard:remove")]
pub async fn signboard_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
