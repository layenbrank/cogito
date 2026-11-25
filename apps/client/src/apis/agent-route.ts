/**
 * 分层路由（`agentRoute:*`）接口：本地优先 → 云兜底的判定与档位落库。
 *
 * 返回值按 Rust 契约声明；调用方仍可再收窄（`features/agent/model/route.ts` 的
 * `narrowPlan`），因为 IPC 回包终究是外部输入。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

/** 与 Rust `agent_route::Tier` 同名字面量 */
type AgentRouteTier = 'local' | 'cloud'

/** 与 Rust `agent_route::Failure` 同名字面量 */
type AgentRouteFailure =
  | 'connectRefused'
  | 'modelMissing'
  | 'unauthorized'
  | 'timeout'
  | 'userCancel'
  | 'unknown'

/** `agentRoute:plan` 的回包（`PlanReply`） */
interface AgentRoutePlanReply {
  plan: {
    /** 本轮该走的档位 */
    tier: AgentRouteTier
    /** 这一档失败后能退到哪（`null` = 已经是尽头） */
    fallback: AgentRouteTier | null
    /** 是否因为「本档不可用」而退到了下一档 */
    degraded: boolean
    /** 给人看的一句话；`degraded` 为真时写清为什么 */
    reason: string
  }
  /** 本机能用的本地模型（`Ready` 之外一律空） */
  localModels: string[]
  /** 探测结论的人话（`Ready` 时为空） */
  probe: string
}

function GET_AGENT_ROUTE_PLAN(params: {
  tier: AgentRouteTier
  model: string | null
}): Promise<AgentRoutePlanReply> {
  return invoke<AgentRoutePlanReply>(CHANNELS.AGENT_ROUTE.PLAN, { params })
}

/** 失败后该换到哪（`DegradeReply`）；`next = null` 表示不换 */
function POST_AGENT_ROUTE_DEGRADE(params: {
  from: AgentRouteTier
  message: string
}): Promise<{ next: AgentRouteTier | null; failure: AgentRouteFailure }> {
  return invoke<{ next: AgentRouteTier | null; failure: AgentRouteFailure }>(
    CHANNELS.AGENT_ROUTE.DEGRADE,
    { params }
  )
}

/** 落库档位；返回落盘后的档位。调用方负责 catch（丢了只影响这一轮） */
function PUT_AGENT_ROUTE_TIER(params: {
  sessionId: string
  tier: AgentRouteTier
}): Promise<AgentRouteTier> {
  return invoke<AgentRouteTier>(CHANNELS.AGENT_ROUTE.SET_TIER, { params })
}

export { GET_AGENT_ROUTE_PLAN, POST_AGENT_ROUTE_DEGRADE, PUT_AGENT_ROUTE_TIER }
export type { AgentRouteFailure, AgentRoutePlanReply, AgentRouteTier }
