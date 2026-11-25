/**
 * agent 运行时杂项接口：agentd 端点/就绪、bridge、cogito 供应商与 token、
 * 子 agent 回填、工具输出归一、composer 队列、sidecar 关停、IPC 就绪、Cursor CLI 状态。
 *
 * 这些命令没有统一的 CRUD 形状，逐个命名（HTTP 动词 + 资源）。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

// ------------------------------------------------------------ agentd

function GET_AGENTD_ENDPOINT<T>(): Promise<T> {
  return invoke<T>(CHANNELS.AGENTD.ENDPOINT)
}

/** `false` / `null` 都表示「还没就绪」，调用方按不可用处理 */
function GET_AGENTD_READY(): Promise<boolean | null> {
  return invoke<boolean | null>(CHANNELS.AGENTD.READY)
}

// ------------------------------------------------------------ bridge

function POST_BRIDGE_INFO<T>(sessionID: string): Promise<T> {
  return invoke<T>(CHANNELS.BRIDGE.INFO, { sessionID })
}

// ------------------------------------------------------------ cogito 供应商 / token

function POST_COGITO_PROVIDER(params: {
  /** Tauri 把 `tenant_id` 解成 `tenantId`（不是业务约定的 `tenantID`） */
  tenantId: string
  baseUrl: string
  models: string[]
  force: boolean
}): Promise<boolean> {
  return invoke<boolean>(CHANNELS.COGITO.PROVIDER_ENSURE, params)
}

function PATCH_COGITO_PROVIDER_TENANT(tenantID: string): Promise<boolean> {
  return invoke<boolean>(CHANNELS.COGITO.PROVIDER_UPDATE_TENANT, { tenantId: tenantID })
}

function POST_COGITO_TOKEN(token: string): Promise<void> {
  return invoke(CHANNELS.COGITO.TOKEN_WRITE, { token })
}

function DELETE_COGITO_TOKEN(): Promise<void> {
  return invoke(CHANNELS.COGITO.TOKEN_CLEAR)
}

// ------------------------------------------------------------ 子 agent / 工具

function POST_AGENT_SUBAGENT_RESULT(report: unknown): Promise<void> {
  return invoke(CHANNELS.AGENT_SUBAGENT.RESULT, { report })
}

function POST_AGENT_TOOL_NORMALIZE_OUTPUT(params: unknown): Promise<{ text: string }> {
  return invoke<{ text: string }>(CHANNELS.AGENT_TOOL.NORMALIZE_OUTPUT, { params })
}

// ------------------------------------------------------------ composer 队列

function GET_AGENT_COMPOSER_QUEUE<T>(sessionID: string): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_COMPOSER_QUEUE.TO_READ, { params: { sessionID } })
}

function PUT_AGENT_COMPOSER_QUEUE<T>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_COMPOSER_QUEUE.TO_REPLACE, { params })
}

// ------------------------------------------------------------ 其它

/** 本机 Cursor Agent CLI 登录态（goose 的 cursor-agent 供应商依赖它） */
interface CursorAgentStatus {
  found: boolean
  binaryPath: string | null
  binaryName: string | null
  authenticated: boolean
  hasApiKeyEnv: boolean
  detail: string
}

function GET_CURSOR_AGENT_STATUS(): Promise<CursorAgentStatus> {
  return invoke<CursorAgentStatus>(CHANNELS.CURSOR_AGENT.STATUS)
}

function GET_IPC_READY(): Promise<boolean | null> {
  return invoke<boolean | null>(CHANNELS.IPC.READY)
}

function POST_SIDECAR_SHUTDOWN(): Promise<void> {
  return invoke(CHANNELS.SIDECAR.SHUTDOWN)
}

export {
  DELETE_COGITO_TOKEN,
  GET_AGENTD_ENDPOINT,
  GET_AGENTD_READY,
  GET_AGENT_COMPOSER_QUEUE,
  GET_CURSOR_AGENT_STATUS,
  GET_IPC_READY,
  PATCH_COGITO_PROVIDER_TENANT,
  POST_AGENT_SUBAGENT_RESULT,
  POST_AGENT_TOOL_NORMALIZE_OUTPUT,
  POST_BRIDGE_INFO,
  POST_COGITO_PROVIDER,
  POST_COGITO_TOKEN,
  POST_SIDECAR_SHUTDOWN,
  PUT_AGENT_COMPOSER_QUEUE
}
export type { CursorAgentStatus }