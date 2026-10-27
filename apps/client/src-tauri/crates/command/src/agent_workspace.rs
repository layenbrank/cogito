#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::agent_workspace::Service;
use cogito_database::Storage;
use cogito_database::entity::agent_workspace::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "agentWorkspace:toWrite")]
pub async fn agentWorkspaceToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentWorkspace:toRead")]
pub async fn agentWorkspaceToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentWorkspace:toUpdate")]
pub async fn agentWorkspaceToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentWorkspace:toRemove")]
pub async fn agentWorkspaceToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
