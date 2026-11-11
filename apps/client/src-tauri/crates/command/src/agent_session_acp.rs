#![allow(non_snake_case)]

//! 会话 ↔ ACP 绑定的 IPC 面（S9）。
//!
//! 四个命令都很窄：绑一条、读一条、列全部、解一条。**没有**「按任意条件查会话」的面
//! —— 渲染进程拿到的只是自己那几个会话的运行态元数据。
//!
//! 为什么单开这三个命令而不是复用 `agentSession:toUpdate`：`toUpdate` 走的是
//! store 的乐观更新（前端要先有一份完整 Session 才敢改），而绑定发生在「连上
//! goose 的那一刻」，那会儿前端最不想赌的就是「本地这份 Session 是不是最新的」。

use cogito_core::CommandResult;
use cogito_core::agent_session::Service;
use cogito_core::agent_session::{BindP, Binding, BoundSession, ReadBindingP};
use cogito_database::Storage;
use tauri::State;

/// 绑定（或刷新）会话的 ACP 信息。
#[tauri::command(rename = "agentSession:bindAcp")]
pub async fn agentSessionBindAcp(
    state: State<'_, Storage>,
    params: BindP,
) -> CommandResult<Binding> {
    Service::bind(state.connection(), params).await
}

/// 读一个会话的绑定；没绑过返回 `null`。
#[tauri::command(rename = "agentSession:readAcpBinding")]
pub async fn agentSessionReadAcpBinding(
    state: State<'_, Storage>,
    params: ReadBindingP,
) -> CommandResult<Option<Binding>> {
    Service::read_binding(state.connection(), &params.session_id).await
}

/// 列出全部已绑定会话：前端启动时一次性灌进内存缓存。
#[tauri::command(rename = "agentSession:listAcpBindings")]
pub async fn agentSessionListAcpBindings(
    state: State<'_, Storage>,
) -> CommandResult<Vec<BoundSession>> {
    Service::list_bindings(state.connection()).await
}

/// 解绑：goose 会话已不可用（连接断开 / 显式关会话）时清掉绑定，
/// 免得刷新后拿死 sessionID 去 `session/load`。返回是否真的清掉了。
#[tauri::command(rename = "agentSession:unbindAcp")]
pub async fn agentSessionUnbindAcp(
    state: State<'_, Storage>,
    params: ReadBindingP,
) -> CommandResult<bool> {
    Service::unbind(state.connection(), &params.session_id).await
}
