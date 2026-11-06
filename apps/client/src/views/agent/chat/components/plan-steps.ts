/**
 * ACP 计划条目（每步三态）→ `elements/agent-plan` 的输入（单个推进下标）。
 *
 * 换算规则与元素的推导一致：进行中那一步就是「正在做」，它之前的都算做完，
 * 之后的还没到。两处共用（对话里的 `plan-data-ui.tsx`、右栏的 `aside-plan.tsx`），
 * 免得同一份 ACP 数据在两个地方算出不同的进度。
 */
import type { ChatPlanEntry } from '@cogito/chat/ports'

/**
 * - 有 `in_progress`：取它的下标（ACP 的计划事件是前缀推进的，通常只有一条）；
 * - 没有进行中：停在第一个没完成的那一步；
 * - 全都完成：`entries.length`（元素把它当成「进度条拉满、没有 active 步」）。
 *
 * 已知偏差：若出现「已完成但排在未完成之后」的乱序事件，那一步会显示成「还没到」。
 * 元素的可视模型是单调推进的，这里不为乱序另造状态。
 */
function toActiveIndex(entries: readonly ChatPlanEntry[]): number {
  const active = entries.findIndex(function (entry) {
    return entry.status === 'in_progress'
  })
  if (active >= 0) return active
  const firstUnfinished = entries.findIndex(function (entry) {
    return entry.status !== 'completed'
  })
  return firstUnfinished >= 0 ? firstUnfinished : entries.length
}

/** 条目 → 元素要的步；下标当稳定 key（ACP 计划条目本身不带 id） */
function toPlanSteps(
  entries: readonly ChatPlanEntry[]
): { readonly id: string; readonly label: string }[] {
  return entries.map(function (entry: ChatPlanEntry, index: number) {
    return { id: `plan-entry-${index}`, label: entry.content }
  })
}

export { toActiveIndex, toPlanSteps }
