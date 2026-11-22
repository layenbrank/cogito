/**
 * Rust `agentTurn:*` 命令的薄封装：后台回合事件环缓冲出 WebView。
 * 无 Tauri 时全部返回 null / no-op，调用方走内存兜底。
 */
import { invoke } from '@tauri-apps/api/core'

import type { ChatStreamEvent } from '@cogito/chat/ports'

import { canUseTauriIpc } from '@/features/window/shell-mode'
import { CHANNELS } from '@/shared/ipc/channels'

interface FollowR {
  events: ChatStreamEvent[]
  nextCursor: number
  status: 'running' | 'done' | 'missing'
}

/**
 * 能不能调 `agentTurn:*`：嵌套预览壳（右栏自载）有 Tauri 运行时，但没有 IPC
 * （不配 capability `remote.urls`），一律当「不可用」走内存兜底。
 */
function hasTauriRuntime(): boolean {
  return canUseTauriIpc()
}

async function POST_AGENT_TURN_ENSURE(threadId: string): Promise<FollowR | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<FollowR>(CHANNELS.AGENT_TURN.ENSURE, { threadId })
  } catch (error) {
    console.warn('[agent-turn] ensure 失败:', error)
    return null
  }
}

async function POST_AGENT_TURN(
  threadId: string,
  events: readonly ChatStreamEvent[]
): Promise<number | null> {
  if (!hasTauriRuntime() || events.length === 0) return null
  try {
    return await invoke<number>(CHANNELS.AGENT_TURN.APPEND, {
      params: { threadId, events }
    })
  } catch (error) {
    console.warn('[agent-turn] append 失败:', error)
    return null
  }
}

async function GET_AGENT_TURN(threadId: string, cursor: number): Promise<FollowR | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<FollowR>(CHANNELS.AGENT_TURN.FOLLOW, {
      params: { threadId, cursor }
    })
  } catch (error) {
    console.warn('[agent-turn] follow 失败:', error)
    return null
  }
}

async function PUT_AGENT_TURN_FINISH(threadId: string): Promise<void> {
  if (!hasTauriRuntime()) return
  try {
    await invoke(CHANNELS.AGENT_TURN.FINISH, { threadId })
  } catch (error) {
    console.warn('[agent-turn] finish 失败:', error)
  }
}

async function DELETE_AGENT_TURN(threadId: string): Promise<void> {
  if (!hasTauriRuntime()) return
  try {
    await invoke(CHANNELS.AGENT_TURN.FORGET, { threadId })
  } catch (error) {
    console.warn('[agent-turn] forget 失败:', error)
  }
}

async function PUT_AGENT_TURN_RUNNING(threadId: string): Promise<string[] | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<string[]>(CHANNELS.AGENT_TURN.MARK_RUNNING, { threadId })
  } catch (error) {
    console.warn('[agent-turn] markRunning 失败:', error)
    return null
  }
}

async function DELETE_AGENT_TURN_RUNNING(threadId: string): Promise<string[] | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<string[]>(CHANNELS.AGENT_TURN.CLEAR_RUNNING, { threadId })
  } catch (error) {
    console.warn('[agent-turn] clearRunning 失败:', error)
    return null
  }
}

async function GET_AGENT_TURNS_RUNNING(): Promise<string[] | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<string[]>(CHANNELS.AGENT_TURN.LIST_RUNNING)
  } catch (error) {
    console.warn('[agent-turn] listRunning 失败:', error)
    return null
  }
}

export {
  POST_AGENT_TURN,
  DELETE_AGENT_TURN_RUNNING,
  POST_AGENT_TURN_ENSURE,
  PUT_AGENT_TURN_FINISH,
  GET_AGENT_TURN,
  DELETE_AGENT_TURN,
  GET_AGENT_TURNS_RUNNING,
  PUT_AGENT_TURN_RUNNING
}
export type { FollowR }
