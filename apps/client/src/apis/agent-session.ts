/**
 * 会话（`agentSession:*`）与 ACP 绑定接口。
 *
 * 存储形态是「键 + 变更」的通用表 CRUD，行类型由调用方给泛型 —— 各业务模块的
 * `Session` 形状不同（渲染进程视图 / Rust 存储行），接口层不重复声明一份。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

/** 会话列表；`params` 原样透传给 Rust 侧过滤器，缺省 = 全量 */
function GET_AGENT_SESSIONS<T>(params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_SESSION.TO_READ, { params })
}

function POST_AGENT_SESSIONS<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_SESSION.TO_WRITE, { params })
}

function PATCH_AGENT_SESSIONS<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_SESSION.TO_UPDATE, { params })
}

/** 返回被删掉的键（含 Rust 侧级联的部分） */
function DELETE_AGENT_SESSIONS<T = string[]>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_SESSION.TO_REMOVE, { params })
}

// ------------------------------------------------------------ ACP 绑定

/** `agent_session` 表里的 ACP 绑定（Rust `Binding`） */
interface AgentSessionACPBinding {
  acpSessionId: string
  cwd: string
  lastSeq: number
  /** 旧行没有这一列，Rust 侧给 `null` */
  lastEpoch: string | null
  routeTier: string
}

/** 列表行：绑定 + 归属会话（Rust `BoundSession`） */
interface AgentSessionACPBindingRow extends AgentSessionACPBinding {
  sessionId: string
}

/** 全量绑定行（启动时一次性灌缓存） */
function GET_AGENT_SESSION_ACP_BINDINGS(): Promise<AgentSessionACPBindingRow[]> {
  return invoke<AgentSessionACPBindingRow[]>(CHANNELS.AGENT_SESSION.LIST_ACP_BINDINGS)
}

/** 绑定 / 刷新一行；`cwd` / `lastSeq` 不传 = 不动 */
function POST_AGENT_SESSION_ACP_BINDING(params: {
  sessionId: string
  acpSessionId: string
  cwd?: string
  lastSeq?: number
  lastEpoch?: string | null
  routeTier?: string
}): Promise<AgentSessionACPBinding> {
  return invoke<AgentSessionACPBinding>(CHANNELS.AGENT_SESSION.BIND_ACP, { params })
}

/** 直接读库；没绑过是 `null` */
function GET_AGENT_SESSION_ACP_BINDING(sessionID: string): Promise<AgentSessionACPBinding | null> {
  return invoke<AgentSessionACPBinding | null>(CHANNELS.AGENT_SESSION.READ_ACP_BINDING, {
    params: { sessionId: sessionID }
  })
}

/** 解绑；返回库里确实删掉了行 */
function DELETE_AGENT_SESSION_ACP_BINDING(sessionID: string): Promise<boolean> {
  return invoke<boolean>(CHANNELS.AGENT_SESSION.UNBIND_ACP, {
    params: { sessionId: sessionID }
  })
}

export {
  DELETE_AGENT_SESSIONS,
  DELETE_AGENT_SESSION_ACP_BINDING,
  GET_AGENT_SESSIONS,
  GET_AGENT_SESSION_ACP_BINDING,
  GET_AGENT_SESSION_ACP_BINDINGS,
  PATCH_AGENT_SESSIONS,
  POST_AGENT_SESSIONS,
  POST_AGENT_SESSION_ACP_BINDING
}
export type { AgentSessionACPBinding, AgentSessionACPBindingRow }
