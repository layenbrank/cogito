#![allow(non_snake_case)]

use tauri::State;
use thinking_core::CommandResult;
use thinking_core::agent_usage::Service;
use thinking_database::Storage;
use thinking_database::entity::agent_usage::{Model, ReadP, RemoveP, UpdateP, WriteP};

#[tauri::command(rename = "agentUsage:toWrite")]
pub async fn agentUsageToWrite(
    state: State<'_, Storage>,
    params: WriteP,
) -> CommandResult<Vec<String>> {
    Service::toWrite(state.connection(), params).await
}

#[tauri::command(rename = "agentUsage:toRead")]
pub async fn agentUsageToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

#[tauri::command(rename = "agentUsage:toUpdate")]
pub async fn agentUsageToUpdate(
    state: State<'_, Storage>,
    params: UpdateP,
) -> CommandResult<Vec<String>> {
    Service::toUpdate(state.connection(), params).await
}

#[tauri::command(rename = "agentUsage:toRemove")]
pub async fn agentUsageToRemove(
    state: State<'_, Storage>,
    params: RemoveP,
) -> CommandResult<Vec<String>> {
    Service::toRemove(state.connection(), params).await
}
