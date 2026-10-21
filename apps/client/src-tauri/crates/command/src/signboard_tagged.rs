use tauri::State;
use thinking_core::CommandResult;
use thinking_core::signboard_tagged::Service;
use thinking_database::Storage;
use thinking_database::entity::signboard_tagged::{Model, ReadP, RemoveP, WriteP};

#[tauri::command(rename = "signboard-tagged:write")]
pub async fn signboard_tagged_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-tagged:read")]
pub async fn signboard_tagged_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-tagged:remove")]
pub async fn signboard_tagged_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
