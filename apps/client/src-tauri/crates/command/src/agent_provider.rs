#![allow(non_snake_case)]

use tauri::State;
use thinking_core::CommandResult;
use thinking_core::agent_provider::Service;
use thinking_database::Storage;
use thinking_database::entity::agent_provider::{Model, ReadP, RemoveP, UpdateP, WriteP};

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
