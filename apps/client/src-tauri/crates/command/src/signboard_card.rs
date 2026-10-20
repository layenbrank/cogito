use tauri::State;
use thinking_core::CommandResult;
use thinking_core::signboard_card::Service;
use thinking_database::Storage;
use thinking_database::entity::signboard_card::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "signboard-card:write")]
pub async fn signboard_card_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-card:read")]
pub async fn signboard_card_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-card:update")]
pub async fn signboard_card_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-card:remove")]
pub async fn signboard_card_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
