#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::agent_session::Service;
use cogito_database::Storage;
use cogito_database::entity::agent_session::{Model, ReadP, RemoveP, UpdateP, WriteP};
use tauri::State;

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
