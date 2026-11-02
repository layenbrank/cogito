/**
 * Rust `agentTurn:*` 命令的薄封装：后台回合事件环缓冲出 WebView。
 * 无 Tauri 时全部返回 null / no-op，调用方走内存兜底。
 */
import { invoke } from '@tauri-apps/api/core'

import type { ChatStreamEvent } from '@cogito/chat/ports'

import { CHANNELS } from '@/shared/ipc/channels'

interface FollowR {
  events: ChatStreamEvent[]
  nextCursor: number
  status: 'running' | 'done' | 'missing'
}

function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

async function ensureAgentTurn(threadId: string): Promise<FollowR | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<FollowR>(CHANNELS.AGENT_TURN.ENSURE, { threadId })
  } catch (error) {
    console.warn('[agent-turn] ensure 失败:', error)
    return null
  }
}

async function appendAgentTurn(threadId: string, events: readonly ChatStreamEvent[]): Promise<void> {
  if (!hasTauriRuntime() || events.length === 0) return
  try {
    await invoke(CHANNELS.AGENT_TURN.APPEND, {
      params: { threadId, events }
    })
  } catch (error) {
    console.warn('[agent-turn] append 失败:', error)
  }
}

async function followAgentTurn(threadId: string, cursor: number): Promise<FollowR | null> {
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

async function finishAgentTurn(threadId: string): Promise<void> {
  if (!hasTauriRuntime()) return
  try {
    await invoke(CHANNELS.AGENT_TURN.FINISH, { threadId })
  } catch (error) {
    console.warn('[agent-turn] finish 失败:', error)
  }
}

async function markAgentTurnRunning(threadId: string): Promise<string[] | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<string[]>(CHANNELS.AGENT_TURN.MARK_RUNNING, { threadId })
  } catch (error) {
    console.warn('[agent-turn] markRunning 失败:', error)
    return null
  }
}

async function clearAgentTurnRunning(threadId: string): Promise<string[] | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<string[]>(CHANNELS.AGENT_TURN.CLEAR_RUNNING, { threadId })
  } catch (error) {
    console.warn('[agent-turn] clearRunning 失败:', error)
    return null
  }
}

async function listAgentTurnRunning(): Promise<string[] | null> {
  if (!hasTauriRuntime()) return null
  try {
    return await invoke<string[]>(CHANNELS.AGENT_TURN.LIST_RUNNING)
  } catch (error) {
    console.warn('[agent-turn] listRunning 失败:', error)
    return null
  }
}

export {
  appendAgentTurn,
  clearAgentTurnRunning,
  ensureAgentTurn,
  finishAgentTurn,
  followAgentTurn,
  listAgentTurnRunning,
  markAgentTurnRunning
}
export type { FollowR }
