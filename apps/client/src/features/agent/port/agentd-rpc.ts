/**
 * agentd 的 HTTP 传输层：endpoint 缓存 + Bearer + JSON 调用。
 *
 * 单独成模块是因为两个消费面都要它：会话层（`port/session.ts`，跑一轮）与
 * goose 配置面（`port/agentd-connection.ts`，providers / 扩展 / 工具权限）。
 */

import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

interface AgentdEndpoint {
  baseUrl: string
  port: number
  pid: number
  version: string
  token: string
}

let cachedEndpoint: AgentdEndpoint | null = null

/** agentd 重启后端点会变；状态事件或 401 都该让缓存失效。 */
function forgetEndpoint(): void {
  cachedEndpoint = null
}

async function findEndpoint(): Promise<AgentdEndpoint> {
  if (cachedEndpoint) return cachedEndpoint
  const value = await invoke<AgentdEndpoint>(CHANNELS.AGENTD.ENDPOINT)
  cachedEndpoint = value
  return value
}

/**
 * 调 agentd 的 HTTP 面。
 *
 * 401 说明 agentd 重启过（令牌变了）：清掉缓存让下次重取，并把错误抛给调用方 ——
 * 静默重试会把「已经换了进程」这件事藏起来，排查时很难受。
 */
async function callAgentd(path: string, init?: RequestInit): Promise<Response> {
  const endpoint = await findEndpoint()
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${endpoint.token}`)
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(`${endpoint.baseUrl}${path}`, { ...init, headers })
  if (response.status === 401) {
    forgetEndpoint()
    throw new Error('agentd 拒绝了这个令牌（可能刚重启过），请重试')
  }
  return response
}

async function callAgentdJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await callAgentd(path, init)
  if (!response.ok) {
    const detail = await response.text().catch(function () {
      return ''
    })
    throw new Error(`agentd ${path} 返回 ${response.status}${detail ? `：${detail}` : ''}`)
  }
  return (await response.json()) as T
}

/** 走白名单透传调用一个 goose ACP 方法（方法名必须在 agentd 的表里）。 */
async function invokeGoose<T = unknown>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  return callAgentdJson<T>('/goose/invoke', {
    method: 'POST',
    body: JSON.stringify({ method, params })
  })
}

export { callAgentd, callAgentdJson, findEndpoint, forgetEndpoint, invokeGoose }
export type { AgentdEndpoint }
