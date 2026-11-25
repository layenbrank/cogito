/**
 * 会话消息（`agentMessage:*`）接口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_AGENT_MESSAGES<T>(params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_MESSAGE.TO_READ, { params })
}

function POST_AGENT_MESSAGES<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_MESSAGE.TO_WRITE, { params })
}

function PATCH_AGENT_MESSAGES<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_MESSAGE.TO_UPDATE, { params })
}

/** 返回「入参 + 按 parentID 级联的子孙」的完整集合 */
function DELETE_AGENT_MESSAGES(params: string[]): Promise<string[]> {
  return invoke<string[]>(CHANNELS.AGENT_MESSAGE.TO_REMOVE, { params })
}

/** 按会话一次取完整对话（含 tool 结果）；`params` 形状见 Rust `LOAD_THREAD` */
function GET_AGENT_MESSAGE_THREAD<T>(params: Record<string, unknown>): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_MESSAGE.LOAD_THREAD, { params })
}

export { DELETE_AGENT_MESSAGES, GET_AGENT_MESSAGES, GET_AGENT_MESSAGE_THREAD, PATCH_AGENT_MESSAGES, POST_AGENT_MESSAGES }
