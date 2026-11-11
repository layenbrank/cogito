/**
 * 思考档位的参考预算（token）。
 *
 * 用途只有一个：把「低 / 中 / 高 / 极高」这种**序数**刻度变成可比较的量，
 * 好让 `elements/reasoning-effort` 那条「已用 / 预算」能给出比例。
 * 取的是扩展思考常见的四档量级（4k / 8k / 16k / 32k），不是模型真实上限。
 *
 * 注意：档位目前**只落本地偏好**（`agent.json` 的 `modelPrefs`），还没下发给 goose ——
 * `GOOSE_*` 里没有对应的思考强度 key。所以这个预算只做仪表，不假装它约束了模型。
 */
import type { ThinkingLevel } from '@/features/persist'

const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  off: 0,
  low: 4_000,
  medium: 8_000,
  high: 16_000,
  max: 32_000
}

function findThinkingBudget(level: ThinkingLevel): number {
  return THINKING_BUDGETS[level] ?? 0
}

export { findThinkingBudget, THINKING_BUDGETS }
