/**
 * 上下文分段的可视化口径（纯函数，单独放一处便于单测）。
 *
 * 分段数据来自 `context-estimate`（系统提示词 / 对话消息 / 工具 / 附件）；这里只回答三件事：
 * ① 每段占多少（色条宽度）；② 什么时候该报警（占用率阈值）；③ 谁最占（排序）。
 *
 * 阈值按**占用率**而不是绝对 token：同一个 70% 在 32k 和 200k 窗口下含义一样，
 * 而绝对数在不同模型之间不可比。
 */
import type { ModelUsageBreakdown } from '@cogito/design/assistant/context'

type ContextSegmentKey = 'system' | 'history' | 'tool' | 'attachment'

interface ContextSegment {
  key: ContextSegmentKey
  label: string
  /** lucide 图标名（与 composer / 详情页同一套） */
  icon: string
  /** 分段色条用的 Tailwind 背景类 */
  tone: string
  tokens: number
  /** 占四段合计的比例 0..1；合计为 0 时是 0 */
  ratio: number
}

type ContextLevel = 'ok' | 'warn' | 'danger'

/** 阈值：70% 提醒、90% 告警。改这两个数就会同时改色条、图标与文案 */
const CONTEXT_WARN_RATIO = 0.7
const CONTEXT_DANGER_RATIO = 0.9

/** 分段定义（顺序即色条从左到右的顺序，也是图例顺序） */
const CONTEXT_SEGMENT_META: readonly Omit<ContextSegment, 'tokens' | 'ratio'>[] = [
  { key: 'system', label: '系统提示词', icon: 'lucide:settings-2', tone: 'bg-sky-500/80' },
  { key: 'history', label: '对话消息', icon: 'lucide:messages-square', tone: 'bg-violet-500/80' },
  { key: 'tool', label: '工具', icon: 'lucide:wrench', tone: 'bg-amber-500/80' },
  { key: 'attachment', label: '附件', icon: 'lucide:paperclip', tone: 'bg-emerald-500/80' }
]

function segmentTokens(usage: ModelUsageBreakdown | undefined, key: ContextSegmentKey): number {
  if (!usage) return 0
  const value =
    key === 'system'
      ? usage.systemTokens
      : key === 'history'
        ? usage.historyTokens
        : key === 'tool'
          ? usage.toolTokens
          : usage.attachmentTokens
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function totalContextTokens(usage: ModelUsageBreakdown | undefined): number {
  return CONTEXT_SEGMENT_META.reduce(function (sum, meta) {
    return sum + segmentTokens(usage, meta.key)
  }, 0)
}

/** 四段 + 比例。合计为 0 时每段 ratio 都是 0（避免除零） */
function splitContextSegments(usage: ModelUsageBreakdown | undefined): ContextSegment[] {
  const total = totalContextTokens(usage)
  return CONTEXT_SEGMENT_META.map(function (meta) {
    const tokens = segmentTokens(usage, meta.key)
    return { ...meta, tokens, ratio: total > 0 ? tokens / total : 0 }
  })
}

/**
 * 把**估算**的四段折算到会话统计给出的真实占用（`used`）。
 *
 * 为什么需要这一步：会话统计（`usage_update.used`）是压缩后**真的**变小了的，
 * 而本地线程里的消息 / 工具结果不会因为压缩而消失。直接拿估算值求和当分子，
 * 压缩完会看到「已用 2000%」——不是压缩失败，是两套口径被加在了一起。
 *
 * 口径：
 * - 估算 ≤ 真实：差额（工具 schema 这类本地看不到的部分）记到对话段，四段之和 = `used`；
 * - 估算 > 真实：整体按比例缩放到 `used`（最大余数法，保证整数的和仍等于 `used`）。
 *
 * `used <= 0`（还没拿到统计）时原样返回 —— 那时只能信估算。
 */
function fitBreakdownToUsed(
  usage: ModelUsageBreakdown | undefined,
  usedTokens: number
): ModelUsageBreakdown {
  const used = Number.isFinite(usedTokens) && usedTokens > 0 ? Math.round(usedTokens) : 0
  const total = totalContextTokens(usage)
  if (used <= 0 || total <= 0) return usage ?? {}
  if (total <= used) {
    return {
      ...usage,
      historyTokens: segmentTokens(usage, 'history') + (used - total)
    }
  }

  const keys: readonly ContextSegmentKey[] = ['system', 'history', 'tool', 'attachment']
  const exact = keys.map(function (key) {
    return (segmentTokens(usage, key) * used) / total
  })
  const floored = exact.map(function (value) {
    return Math.floor(value)
  })
  let remainder = used - floored.reduce(function (sum, value) {
    return sum + value
  }, 0)
  // 最大余数法：按小数部分从大到小补 1，避免缩放后四段之和对不上 `used`
  const order = exact
    .map(function (value, index) {
      return { index, fraction: value - floored[index] }
    })
    .sort(function (a, b) {
      return b.fraction - a.fraction
    })
  for (let cursor = 0; remainder > 0 && cursor < order.length; cursor += 1) {
    floored[order[cursor].index] += 1
    remainder -= 1
  }
  return {
    systemTokens: floored[0],
    historyTokens: floored[1],
    toolTokens: floored[2],
    attachmentTokens: floored[3]
  }
}

/** 占用率 → 档位（含边界：0.70 算提醒、0.90 算告警） */
function contextLevel(ratio: number): ContextLevel {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'ok'
  if (ratio >= CONTEXT_DANGER_RATIO) return 'danger'
  if (ratio >= CONTEXT_WARN_RATIO) return 'warn'
  return 'ok'
}

/** 窗口占用率 → 档位；`max <= 0`（还没拿到模型窗口）时不报警 */
function contextLevelOf(usedTokens: number, maxTokens: number): ContextLevel {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(maxTokens) || maxTokens <= 0) return 'ok'
  return contextLevel(usedTokens / maxTokens)
}

/**
 * 「谁最占上下文」：按 token 倒序取前 `limit` 段，0 token 的段不占位。
 *
 * 只有四段来源，所以默认 Top 5 等于「全部非空段」—— 这里保留 limit 是为了
 * 以后加分段（比如「长期记忆」「系统工具」）时调用方不用改。
 */
function rankContextSegments(
  segments: readonly ContextSegment[],
  limit = 5
): ContextSegment[] {
  return segments
    .filter(function (segment) {
      return segment.tokens > 0
    })
    .slice()
    .sort(function (a, b) {
      return b.tokens - a.tokens
    })
    .slice(0, Math.max(1, limit))
}

export {
  CONTEXT_DANGER_RATIO,
  CONTEXT_SEGMENT_META,
  CONTEXT_WARN_RATIO,
  contextLevel,
  contextLevelOf,
  fitBreakdownToUsed,
  rankContextSegments,
  segmentTokens,
  splitContextSegments,
  totalContextTokens
}
export type { ContextLevel, ContextSegment, ContextSegmentKey }
