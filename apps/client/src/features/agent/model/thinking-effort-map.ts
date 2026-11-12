/**
 * 思考档位的翻译表：cogito 五档 → goose / 供应商**实际认**的取值。
 *
 * 为什么需要这张表：五档是我们自己的产品语义（关闭 / 快速 / 标准 / 深入 / 极致），
 * 而各家接收端并不都是五个值 —— DeepSeek 是 `none｜low｜high｜max`，
 * goose 的全局键是 `off｜low｜medium｜high｜max`，OpenAI 系还有 `xhigh`。
 * 以前我们只把档位写进 `agent.json`，一个字节都没发出去，界面显示「关闭」、
 * 模型其实一直按 high 在思考。
 *
 * 口径：
 * - **不猜**：能拿到会话真实选项列表时，只在列表里挑；挑不到就报 `matched: false`，
 *   由 goose 全局键那层兼容映射兜底；
 * - `degraded` 表示「你要的那一档不存在，落到了邻近档」，UI 要如实显示出来，
 *   否则用户点「标准」看到行为没变，会以为按钮坏了。
 */
import type { ThinkingLevel } from '@/features/persist'

/** 五档的顺序（也是「邻近档」的搜索顺序） */
const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max']

/**
 * 每档的候选值，**按优先级**排列：先找语义最近的正主，再退到相邻档。
 * `medium` 落到 `high` 是有意的（DeepSeek 把 medium 映射成 high），
 * `off` 落到 `none` 也是（关掉思考在 DeepSeek 里就是 `reasoning_effort: none`）。
 */
const THINKING_CANDIDATES: Record<ThinkingLevel, readonly string[]> = {
  off: ['off', 'none', 'disabled'],
  low: ['low', 'minimal'],
  medium: ['medium', 'high'],
  high: ['high', 'medium'],
  max: ['max', 'xhigh']
}

interface ThinkingDispatch {
  /** 真正下发的取值 */
  value: string
  /** 可用值里有没有对应项；false 表示只能靠 goose 的兼容映射 */
  matched: boolean
  /** 用户要的档位不存在，实际落到了邻近档 */
  degraded: boolean
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase()
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some(function (level) {
    return level === value
  })
}

/**
 * 档位 → 实际下发值。
 *
 * `available` 是会话/模型真实给的选项列表；传 null / 空数组表示「不知道」，
 * 这时按 goose 全局键的枚举直接下发 —— 那也是唯一一处「不查表也能对」的情况。
 */
function resolveThinkingValue(
  level: ThinkingLevel,
  available?: readonly string[] | null
): ThinkingDispatch {
  const ids = (available ?? []).map(normalizeValue).filter(function (id) {
    return id.length > 0
  })
  if (ids.length === 0) return { value: level, matched: true, degraded: false }

  for (const candidate of THINKING_CANDIDATES[level]) {
    const hit = ids.find(function (id) {
      return id === candidate
    })
    if (hit) return { value: hit, matched: true, degraded: hit !== level }
  }
  // 一个都不沾：不硬塞，交给 goose 全局键那层兼容映射
  return { value: level, matched: false, degraded: true }
}

export { isThinkingLevel, resolveThinkingValue, THINKING_CANDIDATES, THINKING_LEVELS }
export type { ThinkingDispatch }
