#![allow(non_snake_case)]

//! composer 队列的渲染进程入口。
//!
//! 只暴露两个命令：读整队（`toRead` 按 `sessionID`）与整队替换（`toReplace`）。
//! 单条增删改留在 `Service` 里给未来用，不额外开口子 —— 前端的心智只有
//! 「这条会话现在排着哪几条」，用它一次写完最不容易出现顺序错乱。
use cogito_core::CommandResult;
use cogito_core::agent_composer_queue::Service;
use cogito_database::Storage;
use cogito_database::entity::agent_composer_queue::{Model, ReadP, ReplaceP};
use tauri::State;

#[tauri::command(rename = "agentComposerQueue:toRead")]
pub async fn agentComposerQueueToRead(
    state: State<'_, Storage>,
    params: ReadP,
) -> CommandResult<Vec<Model>> {
    Service::toRead(state.connection(), params).await
}

/// 整队替换：事务内「按 sessionID 先删后插」，`sort` 由服务端按数组下标重排。
#[tauri::command(rename = "agentComposerQueue:toReplace")]
pub async fn agentComposerQueueToReplace(
    state: State<'_, Storage>,
    params: ReplaceP,
) -> CommandResult<Vec<String>> {
    Service::toReplace(state.connection(), params).await
}
