/**
 * AI 网关（cogito `/api/v1/gateway/*`）：模型目录与「我此刻的日窗配额」。
 *
 * 补全不由渲染进程发 —— 客户端把 cogito 注册成 goose 的自定义 provider（PR5 的
 * provider bootstrap），goose 自己带着 provider 的 `auth.command`（token helper）去调网关；
 * 渲染进程只在**发送前**查一次配额、在**设置/选模型**时拉一次目录。
 *
 * 模型与配额都按请求头 `X-Tenant-ID` 归属（`utils/http.ts` 统一注入）。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/** 网关目录条目：`name` 是请求 `model` 字段要用的值，`label` 是给人看的名字 */
interface GatewayModel {
  id: string
  providerID: string
  name: string
  label: string
  enabled: boolean
  /** 模型能力声明（服务端可选下发）；缺省时按「工具可用、推理/视觉未知」处理 */
  capabilities?: { tools?: boolean; reasoning?: boolean; vision?: boolean }
  /** 上下文窗口（token），可选 */
  contextWindow?: number
  createdAt: number
  updatedAt: number
}

/**
 * 计费范围：有租户身份记租户头上，没有就记账号头上。
 * 已知 `TENANT` / `USER`，后端可能加档，故为开放字符串。
 */
type GatewayQuotaScope = string

/** 上限来源：单模型覆盖 / 订阅档位 / 免费档 / 全局兜底。已知 `MODEL` / `PLAN` / `FREE` / `GLOBAL` */
type GatewayQuotaSource = string

/**
 * 「我此刻的日窗配额」只读镜像。
 *
 * 服务端算的不只是上限，还有今日已用（Redis 日窗计数）与是否触顶：这些数字散在
 * 租户档位、模型覆盖、身份归属三处，客户端自己拼不出准值，所以一律以服务端回答为准。
 */
interface GatewaySelfQuota {
  scope: GatewayQuotaScope
  scopeID: string
  tenantID?: string
  tenantType?: string
  source: GatewayQuotaSource
  plan?: string
  /** 日配额上限（token） */
  limit: number
  /** 今日已用（token） */
  used: number
  /** 剩余（服务端已钳到不小于 0） */
  remaining: number
  /** 是否已触顶；触顶后平台模型的新请求会被服务端拒绝（400006） */
  exhausted: boolean
  /** 日窗重置时刻（毫秒时间戳，UTC 零点） */
  resetsAt: number
}

interface GatewaySelfQuotaQuery {
  /** 目录里的模型名；缺省或 `auto` 时按身份级配额回答 */
  model?: string
}

/** 当前用户可见的模型（服务端已按启用状态与角色过滤） */
function GET_GATEWAY_MODELS(signal?: AbortSignal) {
  return http.get<RSF<GatewayModel[]>>('/gateway/models', { env: 'thinking', signal }).then(HttpEnvelope)
}

function GET_GATEWAY_QUOTA_ME(query: GatewaySelfQuotaQuery = {}) {
  return http
    .get<RSF<GatewaySelfQuota>>('/gateway/quota/me', { env: 'thinking', query })
    .then(HttpEnvelope)
}

export { GET_GATEWAY_MODELS, GET_GATEWAY_QUOTA_ME }
export type { GatewayModel, GatewaySelfQuota, GatewaySelfQuotaQuery, GatewayQuotaScope, GatewayQuotaSource }
