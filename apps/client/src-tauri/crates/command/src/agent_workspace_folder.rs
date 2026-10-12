#![allow(non_snake_case)]

use tauri::State;
use thinking_core::CommandResult;
use thinking_core::agent_workspace_folder::Service;
use thinking_database::Storage;
use thinking_database::entity::agent_workspace_folder::{Model, ReadP, RemoveP, UpdateP, WriteP};

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
