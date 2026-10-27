#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::agent_provider::Service;
use cogito_database::Storage;
use cogito_database::entity::agent_provider::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "agentProvider:toWrite")]
pub async fn agentProviderToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentProvider:toRead")]
pub async fn agentProviderToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentProvider:toUpdate")]
pub async fn agentProviderToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentProvider:toRemove")]
pub async fn agentProviderToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
