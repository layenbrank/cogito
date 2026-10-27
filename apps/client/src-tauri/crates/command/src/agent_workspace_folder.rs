#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::agent_workspace_folder::Service;
use cogito_database::Storage;
use cogito_database::entity::agent_workspace_folder::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

#[tauri::command(rename = "agentWorkspaceFolder:toWrite")]
pub async fn agentWorkspaceFolderToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentWorkspaceFolder:toRead")]
pub async fn agentWorkspaceFolderToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentWorkspaceFolder:toUpdate")]
pub async fn agentWorkspaceFolderToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentWorkspaceFolder:toRemove")]
pub async fn agentWorkspaceFolderToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
