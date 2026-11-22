/**
 * 非密偏好（替代 client 的 Tauri Store）。
 *
 * 分层与 client 一致：**内存缓存是同步真源**，`chrome.storage` 是落盘。
 * 界面拿 `findPref()` 同步读（渲染里不能 await），写入走 `patchPref()` 异步落盘。
 *
 * 与 client 的差别只有落点：client 按 namespace 分文件存 JSON，这里一个键装整个对象 ——
 * 扩展的偏好体量小，一个键少一次往返，也不会出现「两个 namespace 同时写导致覆盖」。
 */

import type { ApprovalMode } from '@cogito/agent-protocol/policy'

import { STORAGE_KEYS, findValue, subscribeValue, writeValue } from './storage.ts'

interface AgentPrefs {
  /** 本轮工具该不该问用户（判定逻辑在 `@cogito/agent-runtime/policy`） */
  approvalMode: ApprovalMode
  /** 本机 client 的 agent 代理令牌；空 = 未配置 */
  bridgeToken: string
  /** 上次应答的端口（19828 正式 / 19829 隔离 dev）；null = 还没探到 */
  bridgePort: number | null
  /** 用户选中的接入与模型 */
  providerID: string | null
  model: string | null
}

interface Prefs {
  agent: AgentPrefs
}

const PREFS: Prefs = {
  agent: {
    approvalMode: 'ask',
    bridgeToken: '',
    bridgePort: null,
    providerID: null,
    model: null
  }
}

let cache: Prefs = PREFS
let isReady = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** 只补缺失字段：已存的旧对象里没有的新键用默认值，已存的值一律保留 */
function parsePrefs(value: unknown): Prefs {
  if (!value || typeof value !== 'object') return PREFS
  const bag = value as Partial<Prefs>
  const agent = (bag.agent ?? {}) as Partial<AgentPrefs>
  return {
    agent: {
      approvalMode:
        agent.approvalMode === 'ask' ||
        agent.approvalMode === 'auto' ||
        agent.approvalMode === 'readonly'
          ? agent.approvalMode
          : PREFS.agent.approvalMode,
      bridgeToken:
        typeof agent.bridgeToken === 'string' ? agent.bridgeToken : PREFS.agent.bridgeToken,
      bridgePort: typeof agent.bridgePort === 'number' ? agent.bridgePort : null,
      providerID: typeof agent.providerID === 'string' ? agent.providerID : null,
      model: typeof agent.model === 'string' ? agent.model : null
    }
  }
}

/** 启动期把落盘的偏好灌进内存；重复调用无副作用 */
async function ensurePrefs(): Promise<void> {
  if (isReady) return
  cache = parsePrefs(await findValue<Prefs>(STORAGE_KEYS.prefs))
  isReady = true
  notify()
  // 别的页面改了偏好：内存跟着更新，同页写入也会走这里（幂等）
  subscribeValue(STORAGE_KEYS.prefs, function (value) {
    cache = parsePrefs(value)
    notify()
  })
}

function isPrefsReady(): boolean {
  return isReady
}

/** 同步读（渲染路径专用）。还没 hydrate 时给默认值，不抛错 */
function findPref<K extends keyof Prefs>(namespace: K): Prefs[K] {
  return cache[namespace]
}

async function patchPref<K extends keyof Prefs>(
  namespace: K,
  patch: Partial<Prefs[K]>
): Promise<Prefs[K]> {
  const next: Prefs = {
    ...cache,
    [namespace]: { ...cache[namespace], ...patch }
  }
  // 先改内存：界面必须立刻看到新值，落盘失败也只是「重启后回退」
  cache = next
  notify()
  await writeValue(STORAGE_KEYS.prefs, next)
  return next[namespace]
}

/** 供 `useSyncExternalStore` 订阅 */
function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

export { PREFS, ensurePrefs, findPref, isPrefsReady, patchPref, parsePrefs, subscribePrefs }
export type { AgentPrefs, Prefs }
