#![allow(non_snake_case)]

use tauri::State;
use thinking_core::CommandResult;
use thinking_core::agent_message::Service;
use thinking_database::Storage;
use thinking_database::entity::agent_message::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "agentMessage:toWrite")]
pub async fn agentMessageToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentMessage:toRead")]
pub async fn agentMessageToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentMessage:toUpdate")]
pub async fn agentMessageToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentMessage:toRemove")]
pub async fn agentMessageToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
