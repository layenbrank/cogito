#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::agent_message::Service;
use cogito_database::Storage;
use cogito_database::entity::agent_message::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

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
