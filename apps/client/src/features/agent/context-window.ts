/**
 * 上下文窗口的**分母**取谁。
 *
 * 三个来源，优先级写死在一处：
 * 1. goose 会话统计的 `size`（`usage_update` 给的真实窗口）—— 有就以它为准；
 * 2. 模型偏好里手动设的 `contextWindow` —— 用来纠正 goose 静态目录的错值
 *    （典型：目录给 DeepSeek 写 128k，官方是 1M，于是 80% 自动压缩会在 ~102k 就触发，
 *    把只用了 10% 的上下文提前摘要掉）；
 * 3. 兜底 128k（还没拿到任何统计时）。
 *
 * 口径：**调高生效、调低不生效**。默认偏好就是 128k，如果允许「调低覆盖」，
 * 那所有模型的分母都会被默认值压成 128k —— 那比不知道还糟。
 */
const FALLBACK_MAX_TOKENS = 128_000

type ContextWindowSource = 'stats' | 'preference' | 'fallback'

interface ContextWindow {
  tokens: number
  source: ContextWindowSource
}

function pickContextWindow(statsWindow: number, prefWindow: number): ContextWindow {
  const stats = Number.isFinite(statsWindow) && statsWindow > 0 ? Math.round(statsWindow) : 0
  const pref = Number.isFinite(prefWindow) && prefWindow > 0 ? Math.round(prefWindow) : 0

  if (stats > 0) {
    if (pref > stats) return { tokens: pref, source: 'preference' }
    return { tokens: stats, source: 'stats' }
  }
  if (pref > 0) return { tokens: pref, source: 'preference' }
  return { tokens: FALLBACK_MAX_TOKENS, source: 'fallback' }
}

export { FALLBACK_MAX_TOKENS, pickContextWindow }
export type { ContextWindow, ContextWindowSource }
