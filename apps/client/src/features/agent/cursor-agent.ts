/**
 * 本机 Cursor Agent CLI 状态（`agent` / `cursor-agent`）。
 * 与 Cogito 登录 / 组织网关无关；goose 的 cursor-agent 供应商依赖此登录态。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

interface CursorAgentStatus {
  found: boolean
  binaryPath: string | null
  binaryName: string | null
  authenticated: boolean
  hasApiKeyEnv: boolean
  detail: string
}

async function GET_CURSOR_AGENT_STATUS(): Promise<CursorAgentStatus> {
  return invoke<CursorAgentStatus>(CHANNELS.CURSOR_AGENT.STATUS)
}

function isCursorAgentProviderId(providerId: string): boolean {
  const id = providerId.trim().toLowerCase()
  return id === 'cursor-agent' || id === 'cursor_agent'
}

export { GET_CURSOR_AGENT_STATUS, isCursorAgentProviderId }
export type { CursorAgentStatus }
