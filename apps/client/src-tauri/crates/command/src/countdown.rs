use cogito_core::CommandResult;
use cogito_core::countdown::Service;
use cogito_database::Storage;
use cogito_database::entity::countdown::{Model, Update};
use tauri::State;

#[tauri::command(rename = "countdown:read")]
pub async fn countdown_read(state: State<'_, Storage>) -> CommandResult<Option<Model>> {
    Service::read(state.connection()).await
}

#[tauri::command(rename = "countdown:upsert")]
pub async fn countdown_upsert(state: State<'_, Storage>, params: Model) -> CommandResult<String> {
    Service::upsert(state.connection(), params).await
}

#[tauri::command(rename = "countdown:update")]
pub async fn countdown_update(state: State<'_, Storage>, params: Update) -> CommandResult<String> {
    Service::update(state.connection(), params).await
}
