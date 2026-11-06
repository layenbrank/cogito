/**
 * Tool timeline 的纯函数层：可见步数钳制 + 折叠条文案。
 *
 * 元素本体在 `tool-timeline.tsx`，数据（步 → 动词/芯片、文件改动统计）由宿主
 * 从 `message.parts` 自己映射 —— 与元素页的口径一致：这一步是**你的**，库不猜。
 */
import type { AssistantLabels } from './labels'

/** 一条文件改动：缺 `added` / `removed` 就少写那一半，不补 0 */
interface TimelineStat {
  readonly file: string
  readonly added?: number
  readonly removed?: number
}

type TimelineLabels = Pick<AssistantLabels, 'timelineSteps' | 'filesChanged'>

/**
 * 展开时露出前几步：`visibleSteps` 向下取整并钳进 `0…total`，
 * 所以「步骤已经产生但还没露头」是合法状态（元素页同款）。
 */
function resolveVisibleSteps(visibleSteps: number | undefined, total: number): number {
  if (visibleSteps === undefined) return total
  if (!Number.isFinite(visibleSteps)) return 0
  return Math.max(0, Math.min(Math.floor(visibleSteps), total))
}

/**
 * 折叠条文案：`4 steps · 2 files changed`。
 * 没有文件改动时只留步数 —— 写「0 files changed」等于每次都说一句废话。
 */
function formatTimelineLabel(stepCount: number, fileCount: number, labels: TimelineLabels): string {
  const steps = labels.timelineSteps(stepCount)
  if (fileCount <= 0) return steps
  return `${steps} · ${labels.filesChanged(fileCount)}`
}

export { formatTimelineLabel, resolveVisibleSteps }
export type { TimelineLabels, TimelineStat }
