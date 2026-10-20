use tauri::State;
use thinking_core::CommandResult;
use thinking_core::signboard_card_tag::Service;
use thinking_database::Storage;
use thinking_database::entity::signboard_card_tag::{Model, ReadP, RemoveP, WriteP};

#[tauri::command(rename = "signboard-card-tag:write")]
pub async fn signboard_card_tag_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-card-tag:read")]
pub async fn signboard_card_tag_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-card-tag:remove")]
pub async fn signboard_card_tag_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
