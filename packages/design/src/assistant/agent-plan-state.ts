/**
 * Agent plan（对齐 assistant-ui `elements/agent-plan`）的纯函数层：
 * 步数推进的钳制、每步状态、进度百分比、表头计数文案。
 *
 * 元素的口径很克制：**只有一个 `activeIndex`**，没有每步状态。
 * 「第一步之后的就是做完了、下标那一步是进行中、再往后是还没到」是它的定义，
 * 不是我们的推断 —— 所以这里不做「按 status 反推」的花活，宿主若拿到的是
 * 三态数据（ACP plan），自己换算成 `activeIndex` 再传进来（client 的
 * `plan-data-ui.tsx` 就是那么做的）。
 */
import type { AssistantLabels } from './labels'

/** 一步：字符串就是只有标签的那种，对象可以带稳定 id 与「进行中」的补充说明 */
interface AgentPlanStep {
  readonly id?: string
  readonly label: string
  readonly description?: string
}

/** 归一后的步：`id` 一定存在（缺了就用下标兜底，只当 React key 用） */
interface PlanStep extends AgentPlanStep {
  readonly id: string
}

type PlanStepStatus = 'done' | 'active' | 'ahead'

interface PlanProgress {
  readonly total: number
  /** 已完成的步数（= 钳过的 activeIndex） */
  readonly completed: number
  /** 钳进 `0…total` 的下标；等于 total 表示全部完成，此时没有「进行中」那一步；`-1` = 还没开始 */
  readonly activeIndex: number
  /** 进度条宽度（0–100，整数） */
  readonly percent: number
  readonly allDone: boolean
}

type PlanLabels = Pick<AssistantLabels, 'planCount'>

/**
 * `activeIndex` 钳进 `0…total`：向下取整，`NaN` / 不传当成 0。
 * 越界不报错也不截断列表 —— 传 `total` 或更大就是「全部做完了」。
 */
function resolveActiveIndex(activeIndex: number | undefined, total: number): number {
  if (activeIndex === undefined || !Number.isFinite(activeIndex)) return 0
  return Math.max(0, Math.min(Math.floor(activeIndex), Math.max(0, total)))
}

/** 字符串 → 对象步；对象原样保留（id 缺了补下标） */
function toPlanSteps(steps: readonly (string | AgentPlanStep)[]): PlanStep[] {
  return steps.map(function (step, index): PlanStep {
    const normalized = typeof step === 'string' ? { label: step } : step
    return {
      id: normalized.id ?? `plan-step-${index}`,
      label: normalized.label,
      description: normalized.description
    }
  })
}

function findPlanProgress(
  total: number,
  activeIndex: number | undefined,
  idle = false
): PlanProgress {
  // 「还没开始」：一步都没做完，也没有正在做的那一步（用 -1 表示没人 active）
  if (idle) return { total, completed: 0, activeIndex: -1, percent: 0, allDone: false }
  const clamped = resolveActiveIndex(activeIndex, total)
  return {
    total,
    completed: clamped,
    activeIndex: clamped,
    percent: total === 0 ? 0 : Math.round((clamped / total) * 100),
    allDone: total > 0 && clamped >= total
  }
}

/** 第 `index` 步的状态：下标在已完成区内就是 done，正好等于就是 active，其余是 ahead */
function findStepStatus(index: number, progress: PlanProgress): PlanStepStatus {
  if (index < progress.completed) return 'done'
  if (!progress.allDone && index === progress.activeIndex) return 'active'
  return 'ahead'
}

/** 表头右端的计数：`5 of 5`（文案走 labels，组件里不写死语言） */
function formatPlanCount(progress: PlanProgress, labels: PlanLabels): string {
  return labels.planCount(progress.completed, progress.total)
}

export { findPlanProgress, findStepStatus, formatPlanCount, resolveActiveIndex, toPlanSteps }
export type { AgentPlanStep, PlanLabels, PlanProgress, PlanStep, PlanStepStatus }
