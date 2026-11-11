/**
 * 会话 ↔ ACP 绑定（S9）：库是唯一源，内存缓存只用来做**同步**查询。
 *
 * 为什么要搬：以前这张映射只活在渲染进程的 localStorage 里，换机器 / 清缓存 /
 * 重装就丢，「刷新后恢复进行中回合」跟着失效；而且 `acpCwd` 这类东西一旦写错，
 * 恢复出来的回合会读错工作目录。现在落 `agent_session.acpSessionID / acpCwd /
 * lastSeq / routeTier` 四列（老库由 `ensure_agent_session()` 补列）。
 *
 * 三条约束：
 * - **不做静默造行**：绑定时会话行不存在，Rust 侧报 `NotFound`，这里只 `warn`
 *   并返回 `null` —— 前端不能拿一个不存在的会话 ID 换来一条假绑定；
 * - **写失败不阻断主流程**：绑定是运行态元数据，写不进去顶多「刷新后恢复不了」，
 *   不该让这一轮对话起不来；
 * - **缓存与库同形**：`recallBinding()` 返回的对象和 `bindSession()` 返回的一致，
 *   调用方不用关心数据是从库来的还是缓存来的。
 */
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { CHANNELS } from '@/shared/ipc/channels'

export const SessionBindingSchema = z.object({
  acpSessionId: z.string(),
  cwd: z.string(),
  lastSeq: z.number().int().nonnegative(),
  routeTier: z.string()
})

export type SessionBinding = z.infer<typeof SessionBindingSchema>

const BoundSessionSchema = SessionBindingSchema.extend({
  sessionId: z.string()
})

/** threadID → 绑定。只由本模块写，调用方只读。 */
const cache = new Map<string, SessionBinding>()

function key(threadID: string): string {
  return threadID.trim()
}

/** 读缓存（同步）。没同步上返回 `null`，调用方走自己的兜底路径。 */
export function recallBinding(threadID: string): SessionBinding | null {
  const id = key(threadID)
  if (!id) return null
  return cache.get(id) ?? null
}

/**
 * 启动时把库里的绑定一次性灌进缓存。
 *
 * 返回条数，方便调用方打一行日志；失败返回 0（内存缓存留空，等于「都没绑过」）。
 */
export async function preloadBindings(): Promise<number> {
  try {
    const raw = await invoke<unknown>(CHANNELS.AGENT_SESSION.LIST_ACP_BINDINGS)
    const rows = z.array(BoundSessionSchema).parse(raw ?? [])
    for (const row of rows) {
      cache.set(row.sessionId, {
        acpSessionId: row.acpSessionId,
        cwd: row.cwd,
        lastSeq: row.lastSeq,
        routeTier: row.routeTier
      })
    }
    return rows.length
  } catch (error) {
    console.warn('[acp/session-binding] 预载绑定失败，按「都没绑过」处理:', error)
    return 0
  }
}

export interface BindInput {
  acpSessionId: string
  cwd?: string
  lastSeq?: number
  routeTier?: string
}

/**
 * 绑定 / 刷新一个会话的 ACP 信息。返回库里的最新值（trim 过），失败返回 `null`。
 *
 * `cwd` / `lastSeq` 不传就是「不动」—— 每轮只刷序号时不必重复传工作目录。
 */
export async function bindSession(
  threadID: string,
  input: BindInput
): Promise<SessionBinding | null> {
  const id = key(threadID)
  if (!id || !input.acpSessionId.trim()) return null
  try {
    const raw = await invoke<unknown>(CHANNELS.AGENT_SESSION.BIND_ACP, {
      params: { sessionId: id, ...input }
    })
    const binding = SessionBindingSchema.parse(raw)
    cache.set(id, binding)
    return binding
  } catch (error) {
    console.warn('[acp/session-binding] 绑定失败（不影响本轮对话）:', error)
    return null
  }
}

/** 直接读库（缓存未命中时用；命中过就顺手写缓存）。 */
export async function readBinding(threadID: string): Promise<SessionBinding | null> {
  const id = key(threadID)
  if (!id) return null
  const cached = cache.get(id)
  if (cached) return cached
  try {
    const raw = await invoke<unknown>(CHANNELS.AGENT_SESSION.READ_ACP_BINDING, {
      params: { sessionId: id }
    })
    if (raw === null || raw === undefined) return null
    const binding = SessionBindingSchema.parse(raw)
    cache.set(id, binding)
    return binding
  } catch (error) {
    console.warn('[acp/session-binding] 读绑定失败，按「没绑过」处理:', error)
    return null
  }
}

/**
 * 解绑：goose 会话已经不可用（连接断开 / 显式关会话）时清掉。
 *
 * 先删缓存再发请求 —— 恢复路径读的是缓存，宁可「看起来没绑过」，也不要让
 * `resumeThreadRun` 拿一个死 sessionID 去 `session/load`（那边早就没这个会话了，
 * 用户只会看到恢复失败）。请求失败只 warn：库里留一条脏绑定顶多让下次恢复失败
 * 一次，不该阻断关闭会话的流程。
 */
export async function unbindSession(threadID: string): Promise<boolean> {
  const id = key(threadID)
  if (!id) return false
  const hadCache = cache.delete(id)
  try {
    const cleared = await invoke<unknown>(CHANNELS.AGENT_SESSION.UNBIND_ACP, {
      params: { sessionId: id }
    })
    return cleared === true || hadCache
  } catch (error) {
    console.warn('[acp/session-binding] 解绑失败（不影响关闭会话）:', error)
    return hadCache
  }
}

/** 仅测试用：清空缓存。 */
export function __resetBindingCache(): void {
  cache.clear()
}
