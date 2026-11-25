/**
 * 本机 client 的 agent 代理（`/api/v1/agent/*`）—— 扩展侧唯一的「全能力」通道。
 *
 * ## 这条链在做什么
 *
 * 扩展 → `127.0.0.1:19828/api/v1/agent/*` → client 的 Rust → agentd。
 * 扩展带的是**本机 API 令牌**（用户在桌面端设置里生成），agentd 的令牌始终在 Rust 进程里，
 * 扩展永远看不到。
 *
 * ## 为什么先探两个端口
 *
 * 正式包绑 19828，隔离 dev 实例绑 19829（两个客户端能同时跑）。扩展先试**上次成功的
 * 那个**，再试另一个 —— 每次都从 19828 开始会让「用隔离实例开发」的人多等一次超时。
 *
 * ## 状态的四种失败要分得开
 *
 * `agentdReady` / `enabled` / `authConfigured` / `authorized` 是四个独立事实：
 * 「没装客户端」「没开代理开关」「没配令牌」「令牌不对」给出的**处理动作完全不同**，
 * 界面上必须能分别说清，否则用户只会看到一句「连接失败」。
 */

import { createAgentdTransport } from '@cogito/agent-runtime/agentd'

import { findPref, patchPref } from '@/features/platform/prefs.ts'

/** 正式包 / 隔离 dev 实例 */
const BRIDGE_PORTS = [19828, 19829] as const
const PROBE_TIMEOUT_MS = 1_500
const PROBE_TTL_MS = 5_000

interface BridgeStatus {
  enabled: boolean
  /** 服务端恒定要求令牌；保留字段是为了协议对齐 */
  authRequired: boolean
  /** 桌面端有没有配令牌 */
  authConfigured: boolean
  /** 本次请求带的令牌是否被接受 */
  authorized: boolean
  /** 桌面端开了「允许局域网」—— 此时 agent 面一律 403 */
  lanExposed: boolean
  agentdReady: boolean
  agentdVersion: string | null
  restarts: number
  port: number
  basePath: string
}

interface BridgeProbe {
  port: number
  status: BridgeStatus
}

type BridgeOutcome =
  | { ok: true; probe: BridgeProbe }
  | { ok: false; reason: string }

let cached: { probe: BridgeProbe | null; at: number } = { probe: null, at: 0 }

function bridgeBase(port: number): string {
  return `http://127.0.0.1:${port}/api/v1/agent`
}

function parseStatus(port: number, value: unknown): BridgeStatus | null {
  if (!value || typeof value !== 'object') return null
  const bag = value as Record<string, unknown>
  if (typeof bag.enabled !== 'boolean') return null
  return {
    enabled: bag.enabled,
    authRequired: bag.authRequired === true,
    authConfigured: bag.authConfigured === true,
    authorized: bag.authorized === true,
    lanExposed: bag.lanExposed === true,
    agentdReady: bag.agentdReady === true,
    agentdVersion: typeof bag.agentdVersion === 'string' ? bag.agentdVersion : null,
    restarts: typeof bag.restarts === 'number' ? bag.restarts : 0,
    port: typeof bag.port === 'number' ? bag.port : port,
    basePath: typeof bag.basePath === 'string' ? bag.basePath : '/api/v1/agent'
  }
}

/** 探一个端口：连不上（客户端没跑 / 端口不对）返回 null，而不是抛错 */
async function probePort(port: number, token: string): Promise<BridgeProbe | null> {
  try {
    const response = await fetch(`${bridgeBase(port)}/status`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (!response.ok) return null
    const status = parseStatus(port, await response.json())
    return status ? { port, status } : null
  } catch (error) {
    // 连接被拒是**正常情况**（客户端没装 / 没启动），不打日志刷屏
    console.info(`[bridge] 端口 ${port} 无应答:`, error instanceof Error ? error.message : error)
    return null
  }
}

/** 端口顺序：上次成功的优先，其余按常量顺序 */
function findPortOrder(): number[] {
  const remembered = findPref('agent').bridgePort
  const rest = BRIDGE_PORTS.filter(function (port) {
    return port !== remembered
  })
  return remembered === null ? [...BRIDGE_PORTS] : [remembered, ...rest]
}

async function findProbe(force = false): Promise<BridgeProbe | null> {
  if (!force && cached.probe && Date.now() - cached.at < PROBE_TTL_MS) return cached.probe
  const token = findPref('agent').bridgeToken
  for (const port of findPortOrder()) {
    const probe = await probePort(port, token)
    if (!probe) continue
    cached = { probe, at: Date.now() }
    if (findPref('agent').bridgePort !== port) {
      void patchPref('agent', { bridgePort: port })
    }
    return probe
  }
  cached = { probe: null, at: Date.now() }
  return null
}

/** 把「连不上」翻译成用户能照着做的下一步 */
function explainFailure(probe: BridgeProbe | null): string {
  if (!probe) {
    return '没有找到本机客户端：请确认桌面端已启动（隔离 dev 实例会占用 19829）'
  }
  const status = probe.status
  if (status.lanExposed) {
    return '桌面端开启了「允许局域网」，agent 代理在这种模式下会被拒绝：请先关掉它'
  }
  if (!status.enabled) {
    return '桌面端的 agent 代理未启用：设置 → 知识库 → API / Clip 守护 → 打开「Agent 代理」'
  }
  if (!status.authConfigured) {
    return '桌面端还没有生成令牌：在同一区块点「生成」，再把它填到扩展设置里'
  }
  if (!status.authorized) {
    return '令牌不匹配：请把桌面端的令牌复制到扩展设置里'
  }
  if (!status.agentdReady) {
    return 'agentd 未就绪（可能还在启动或已崩溃）：到桌面端诊断页看一下'
  }
  return '本机代理不可用'
}

/** 完整判定：能不能真正发请求 */
async function findBridge(force = false): Promise<BridgeOutcome> {
  const probe = await findProbe(force)
  if (!probe) return { ok: false, reason: explainFailure(null) }
  const isUsable =
    probe.status.enabled &&
    probe.status.agentdReady &&
    probe.status.authorized &&
    !probe.status.lanExposed
  return isUsable ? { ok: true, probe } : { ok: false, reason: explainFailure(probe) }
}

/** 仅用于展示的当前状态（不做「是否可用」的判定） */
async function findBridgeStatus(force = false): Promise<BridgeProbe | null> {
  return findProbe(force)
}

/** 带令牌请求一次代理路径（`path` 是 `/threads/...` 这样的 agentd 路径） */
const agentdTransport = createAgentdTransport({
  // 扩展与桌面端共用同一身份头：agentd 据此判断「同 thread 的写者是不是自己」
  clientId: `ext-${crypto.randomUUID()}`,
  async findEndpoint() {
    const outcome = await findBridge()
    if (!outcome.ok) throw new Error(outcome.reason)
    const probe = outcome.probe
    return {
      baseUrl: bridgeBase(probe.port),
      port: probe.port,
      // 这四项在代理场景里只有 baseUrl/token 有意义，其余是传输层的形状要求
      pid: 0,
      version: probe.status.agentdVersion ?? '',
      token: findPref('agent').bridgeToken
    }
  }
})

/**
 * 带令牌请求一次代理路径。
 *
 * 直接复用 `createAgentdTransport` 而不是自己拼 fetch：401 失效、Bearer 头、body 的
 * content-type 这些语义两端必须一样 —— 否则「client 正常、扩展偶发 401」会变成排查黑洞。
 */
function callBridge(path: string, init?: RequestInit): Promise<Response> {
  return agentdTransport.call(path, init)
}

async function callBridgeJson<T>(path: string, init?: RequestInit): Promise<T> {
  return agentdTransport.callJson<T>(path, init)
}

/** 端口记忆失效（例如客户端重启后换了实例）：下次请求重新探 */
function forgetBridge(): void {
  cached = { probe: null, at: 0 }
}

export {
  BRIDGE_PORTS,
  agentdTransport,
  bridgeBase,
  callBridge,
  callBridgeJson,
  explainFailure,
  findBridge,
  findBridgeStatus,
  forgetBridge,
  parseStatus
}
export type { BridgeOutcome, BridgeProbe, BridgeStatus }
