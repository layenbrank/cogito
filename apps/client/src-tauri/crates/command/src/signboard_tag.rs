use cogito_core::CommandResult;
use cogito_core::signboard_tag::Service;
use cogito_database::Storage;
use cogito_database::entity::signboard_tag::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "signboard-tag:write")]
pub async fn signboard_tag_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-tag:read")]
pub async fn signboard_tag_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-tag:update")]
pub async fn signboard_tag_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-tag:remove")]
pub async fn signboard_tag_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
