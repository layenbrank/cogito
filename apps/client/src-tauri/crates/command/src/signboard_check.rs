use cogito_core::CommandResult;
use cogito_core::signboard_check::Service;
use cogito_database::Storage;
use cogito_database::entity::signboard_check::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "signboard-check:write")]
pub async fn signboard_check_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-check:read")]
pub async fn signboard_check_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-check:update")]
pub async fn signboard_check_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-check:remove")]
pub async fn signboard_check_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
