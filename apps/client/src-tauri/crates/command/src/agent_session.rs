#![allow(non_snake_case)]

use tauri::State;
use thinking_core::CommandResult;
use thinking_core::agent_session::Service;
use thinking_database::Storage;
use thinking_database::entity::agent_session::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "agentSession:toWrite")]
pub async fn agentSessionToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentSession:toRead")]
pub async fn agentSessionToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentSession:toUpdate")]
pub async fn agentSessionToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentSession:toRemove")]
pub async fn agentSessionToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
