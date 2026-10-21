use tauri::State;
use thinking_core::CommandResult;
use thinking_core::signboard_automation::Service;
use thinking_database::Storage;
use thinking_database::entity::signboard_automation::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "signboard-automation:write")]
pub async fn signboard_automation_write(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "signboard-automation:read")]
pub async fn signboard_automation_read(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "signboard-automation:update")]
pub async fn signboard_automation_update(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "signboard-automation:remove")]
pub async fn signboard_automation_remove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
