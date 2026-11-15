/**
 * 编排层宿主的就绪状态机：`agentd://status` 事件的**唯一**契约。
 *
 * ## 与旧 `gooseStatus.ts` 的关系
 *
 * 旧契约描述的是「goose serve 就绪了没有」——那是 Rust 自己 spawn 的 wss 后端。
 * 现在那个进程不存在了：Rust 托管的是 **agentd**，而 goose 是 agentd 的内部子进程，
 * 它的状态由 `/health` 的 `goose` 字段一并报上来。
 *
 * ## 为什么还要保留 `state/readyMs/reason` 三个字段名
 *
 * 诊断页与「正在启动」的文案都按这三个字段渲染。把它们改掉只会换来一次无收益的
 * 全量改文案；真正新增的信息（端口、pid、内层 goose、重启次数）是**追加**的字段。
 */
import { z } from 'zod'

import { EVENTS } from '@/shared/ipc/channels'

const AgentdStateSchema = z.enum(['starting', 'ready', 'failed'])

/** agentd 视角的内层 goose 状态 */
const GoosePhaseSchema = z.enum(['disabled', 'starting', 'ready', 'failed'])

const AgentdStatusSchema = z.object({
  state: AgentdStateSchema,
  /** spawn → 就绪的毫秒数（`ready` 时才有） */
  readyMs: z.number().int().nonnegative().optional(),
  /** agentd 监听的端口（内核分配的） */
  port: z.number().int().nonnegative().optional(),
  /** agentd 的 pid，用来核对「我连的是不是我刚起的那一个」 */
  pid: z.number().int().nonnegative().optional(),
  /** 内层 goose 的状态 */
  goose: GoosePhaseSchema.optional(),
  /** 已发生的自动重启次数（诊断页用它判断是不是在反复崩） */
  restarts: z.number().int().nonnegative().optional(),
  /** 宿主进程 RSS */
  rssBytes: z.number().int().nonnegative().optional(),
  /** 失败原因（`failed` 时才有） */
  reason: z.string().optional()
})

type AgentdState = z.infer<typeof AgentdStateSchema>
type AgentdStatus = z.infer<typeof AgentdStatusSchema>

const AGENTD_STATUS_EVENT = EVENTS.AGENTD_STATUS

export { AGENTD_STATUS_EVENT, AgentdStateSchema, AgentdStatusSchema, GoosePhaseSchema }
export type { AgentdState, AgentdStatus }
