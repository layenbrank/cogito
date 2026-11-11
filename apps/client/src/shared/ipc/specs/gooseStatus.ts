/**
 * goose 就绪状态机（S4）：`goose://status` 事件的**唯一**契约。
 *
 * 之前前端靠 `READY_POLL_MS = 500` 每半秒 `invoke('goose:ready')` 轮询 —— 冷启动时
 * 一个页面能打出几十次 IPC，且「就绪」这件事在 Rust 侧只存在于内存里，前端只能猜。
 * 现在 Rust 在 `utils/goose_serve.rs` 里 emit 一次，前端在这里 parse 一次：
 * 字段名（`readyMs` / `rssBytes` / `gooseRssBytes`）两边漂移会被 `gooseStatus.test.ts` 抓住。
 *
 * `goose:ready` 命令仍然保留，但只作**兜底**：事件可能在订阅之前就发出去了。
 */
import { z } from 'zod'

import { EVENTS } from '@/shared/ipc/channels'

const GooseStateSchema = z.enum(['starting', 'ready', 'failed'])

const GooseStatusSchema = z.object({
  state: GooseStateSchema,
  /** spawn → 就绪的毫秒数（`ready` 时才有） */
  readyMs: z.number().int().nonnegative().optional(),
  /** 宿主进程 RSS（S10 并行会话的容量基线） */
  rssBytes: z.number().int().nonnegative().optional(),
  /** goose serve 子进程 RSS */
  gooseRssBytes: z.number().int().nonnegative().optional(),
  /** 失败原因（`failed` 时才有） */
  reason: z.string().optional()
})

type GooseState = z.infer<typeof GooseStateSchema>
type GooseStatus = z.infer<typeof GooseStatusSchema>

const GOOSE_STATUS_EVENT = EVENTS.GOOSE_STATUS

export { GOOSE_STATUS_EVENT, GooseStateSchema, GooseStatusSchema }
export type { GooseState, GooseStatus }
