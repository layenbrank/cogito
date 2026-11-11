/**
 * 分层路由（S11）：本地优先 → 云兜底。
 *
 * 判定的「大脑」在 Rust（`crates/core/src/agent_route.rs`）：什么时候该降级由它说；
 * 这里只做三件事 —— 记住本会话的档位、挑出本轮该用哪个 provider、把失败反馈给判定。
 *
 * 三条与后端一致的硬规则（前端不许自己另立规矩，否则两边会给出不同结论）：
 * ① 默认本地：档位 `local` 时优先本地 provider，本地不可用才走云。
 * ② 只在**可判定失败**时降级：连接被拒 / 模型不存在；超时、鉴权失败不降级。
 * ③ 用户取消**绝不**降级 —— 他把这一轮停了，不是让你换台机器再跑一遍。
 *
 * 探测（Ollama `/api/tags`）也在 Rust：渲染进程不该为了路由去直连本地端口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

/** 路由档位。与 Rust 侧 `agent_route::Tier` 同名字面量。 */
type RouteTier = 'local' | 'cloud'

/** 本地 provider 的 kind：与 `model/display.ts` 里标了「本地」的那几项对齐 */
const LOCAL_KINDS: readonly string[] = ['ollama', 'atomic', 'local']

const ROUTE_TIERS: readonly RouteTier[] = ['local', 'cloud']

/** 默认档位：本地优先（`agent_session.routeTier` 的库默认值也是它） */
const DEFAULT_TIER: RouteTier = 'local'

function isLocalKind(kind: string): boolean {
  return LOCAL_KINDS.includes(kind.trim().toLowerCase())
}

function isRouteTier(value: unknown): value is RouteTier {
  return typeof value === 'string' && (ROUTE_TIERS as readonly string[]).includes(value)
}

/** `agentRoute:plan` 的返回（字段按 Rust 的 camelCase 契约） */
interface RoutePlanReply {
  plan: {
    tier: RouteTier
    fallback: RouteTier | null
    degraded: boolean
    reason: string
  }
  localModels: string[]
  probe: string
}

/** provider 的选择只看这三个字段，测试里不用造完整的 AgentProvider */
interface RouteProvider {
  id: string
  kind: string
  enabled: boolean
}

/**
 * 进程内的档位缓存。
 *
 * 为什么不放 localStorage：S9 已经把它落进 `agent_session.routeTier` 了，渲染进程再存一份
 * 就是第二个真相源。进程内缓存只负责「这一轮别每次都去问库」。
 */
let currentTier: RouteTier = DEFAULT_TIER

function readRouteTier(): RouteTier {
  return currentTier
}

/**
 * 改档位并（可选）落库。
 *
 * 落库失败只打 warn：档位是偏好，丢了最多这一轮走错路，不能让一次发送失败。
 */
function markRouteTier(tier: RouteTier, sessionID?: string | null): void {
  currentTier = tier
  const id = sessionID?.trim()
  if (!id) return
  void invoke(CHANNELS.AGENT_ROUTE.SET_TIER, {
    params: { sessionId: id, tier }
  }).catch(function (error: unknown) {
    console.warn('[agent/route] 档位落库失败（不影响本轮）:', error)
  })
}

/** 把 Rust 的返回收窄成契约（外部输入一律当成不可信） */
function narrowPlan(raw: unknown): RoutePlanReply | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<RoutePlanReply>
  const plan = value.plan
  if (!plan || typeof plan !== 'object') return null
  if (!isRouteTier(plan.tier) || typeof plan.degraded !== 'boolean') return null
  return {
    plan: {
      tier: plan.tier,
      fallback: isRouteTier(plan.fallback) ? plan.fallback : null,
      degraded: plan.degraded,
      reason: typeof plan.reason === 'string' ? plan.reason : ''
    },
    localModels: Array.isArray(value.localModels)
      ? value.localModels.filter((item): item is string => typeof item === 'string')
      : [],
    probe: typeof value.probe === 'string' ? value.probe : ''
  }
}

/**
 * 规划本轮路由：探一次本地，拿到「该走哪条路」。
 *
 * 失败（IPC 挂了 / 判定异常）返回 `null` —— 调用方按**不降级**处理：
 * 探测不出来不等于本地不可用，悄悄换云等于把数据送出本机。
 */
async function planRoute(tier: RouteTier, model: string | null): Promise<RoutePlanReply | null> {
  try {
    const raw = await invoke<unknown>(CHANNELS.AGENT_ROUTE.PLAN, {
      params: { tier, model }
    })
    const reply = narrowPlan(raw)
    if (!reply) {
      console.warn('[agent/route] 路由判定返回不可识别，按本地可用处理:', raw)
      return null
    }
    return reply
  } catch (error) {
    console.warn('[agent/route] 路由判定失败，按本地可用处理:', error)
    return null
  }
}

/**
 * 失败之后该换到哪。`null` = 不换（原地报错）。
 *
 * 归类在 Rust；这里只保证「判定不可用时不换」。
 */
async function degradeRoute(from: RouteTier, message: string): Promise<RouteTier | null> {
  try {
    const raw = await invoke<{ next?: unknown; failure?: unknown }>(
      CHANNELS.AGENT_ROUTE.DEGRADE,
      { params: { from, message } }
    )
    return isRouteTier(raw?.next) ? raw.next : null
  } catch (error) {
    console.warn('[agent/route] 降级判定失败（按不降级处理）:', error)
    return null
  }
}

/** 挑出本轮该用的 provider（纯函数，测试友好） */
function pickProvider(input: {
  providers: readonly RouteProvider[]
  activeProviderID: string | null
  tier: RouteTier
}): RouteProvider | null {
  const enabled = input.providers.filter(function (provider) {
    return provider.enabled
  })
  const active =
    enabled.find(function (provider) {
      return provider.id === input.activeProviderID
    }) ??
    enabled[0] ??
    null
  if (input.tier === 'cloud') return active
  return (
    enabled.find(function (provider) {
      return isLocalKind(provider.kind)
    }) ??
    active ??
    null
  )
}

/**
 * 一轮失败后的收尾：可判定失败就把档位切到云，下一轮自动走云端。
 *
 * 返回新档位（`null` = 没换）。调用方**不需要** await —— 失败路径不该再被路由拖慢。
 */
async function noteRunFailure(input: {
  from: RouteTier
  message: string
  sessionID?: string | null
}): Promise<RouteTier | null> {
  const next = await degradeRoute(input.from, input.message)
  if (!next) return null
  markRouteTier(next, input.sessionID)
  console.info('[agent/route] 本轮可判定失败，已降级到', next)
  return next
}

export {
  DEFAULT_TIER,
  degradeRoute,
  isLocalKind,
  isRouteTier,
  markRouteTier,
  noteRunFailure,
  pickProvider,
  planRoute,
  readRouteTier
}
export type { RoutePlanReply, RouteProvider, RouteTier }
