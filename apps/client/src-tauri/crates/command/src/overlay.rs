use cogito_core::CommandResult;
use cogito_core::overlay::Service;
use cogito_database::Storage;
use cogito_database::entity::overlay as schema;
use tauri::State;

#[tauri::command(rename = "overlay:read")]
pub async fn overlay_read(state: State<'_, Storage>) -> CommandResult<Vec<schema::Model>> {
    Service::read(state.connection()).await
}

#[tauri::command(rename = "overlay:write")]
pub async fn overlay_write(
    state: State<'_, Storage>,
    item: schema::Write,
) -> CommandResult<String> {
    Service::write(state.connection(), item).await
}

#[tauri::command(rename = "overlay:update")]
pub async fn overlay_update(
    state: State<'_, Storage>,
    id: String,
    patch: schema::Update,
) -> CommandResult<()> {
    Service::update(state.connection(), id, patch).await
}

#[tauri::command(rename = "overlay:remove")]
pub async fn overlay_remove(state: State<'_, Storage>, ids: Vec<String>) -> CommandResult<()> {
    Service::remove(state.connection(), ids).await
}
