/**
 * Job progress（对齐 assistant-ui `elements/job-progress`）的纯函数层：
 * 加权进度、阶段下标 / 份额的钳制、终态收据、耗时格式化与色调映射。
 *
 * 元素的口径（官网 `.md` 原文，照抄过来免得实现走样）：
 * - `stageIndex` 向下取整并钳进 `0…stages.length`；**没有 `outcome` 时**到达长度
 *   就是「成功跑完」—— 这时进度条自己拉满，不需要宿主再报一个 success；
 * - `stageProgress` 钳进 `0…1`，只贡献**当前阶段**那一段的加权份额；
 * - `outcome` 压过数字进度：`success` 把条拉满，`partial / failed / cancelled`
 *   **保持条与 `aria-valuenow` 在实际到达的位置**（收据说失败，但条不该倒退）。
 *
 * 这里不碰 React —— 外壳在 `job-progress.tsx`。分成两个文件是为了让
 * 「权重怎么算」「百分比取到哪」能直接单测（与 `agent-plan-state.ts` 同一套做法）。
 */
import type { AssistantLabels } from './labels'
import { formatRunDuration } from './run-activity-state'

/** 收据状态：成功的四种说法 */
type JobOutcomeStatus = 'success' | 'partial' | 'failed' | 'cancelled'

/** 运行中 + 四种收据 */
type JobState = 'running' | JobOutcomeStatus

type JobStageStatus = 'done' | 'active' | 'ahead'

interface JobStage {
  readonly name: string
  /** 在整条进度条里的相对份额（不是百分比，也不必加起来等于 100） */
  readonly weight: number
  /** 只有它是**当前阶段**时才显示的一行说明 */
  readonly description?: string
}

interface JobOutcome {
  readonly status: JobOutcomeStatus
  /** 收据下面的一段话（`Build passed. Tests stopped after the preview timed out.`） */
  readonly summary?: string
}

/** 归一后的阶段：补稳定 id，权重兜底成 1，算出这一步在整条条上的状态 */
interface JobStageView {
  readonly id: string
  readonly name: string
  readonly description?: string
  /** 归一后的权重（非法值 / 全零时按等权兜底） */
  readonly weight: number
  readonly status: JobStageStatus
}

interface JobProgress {
  readonly state: JobState
  /** 收据态：有 `outcome`，或者索引已经走到 `stages.length`（无 outcome 的成功） */
  readonly settled: boolean
  /** 进度条宽度（0–100，整数）；success 恒为 100，其余保持实际到达的位置 */
  readonly percent: number
  /** 钳进 `0…stages.length` 的阶段下标 */
  readonly stageIndex: number
  readonly stages: readonly JobStageView[]
  /** 当前阶段（下标等于长度时没有，收据态可能仍落在最后一段中途） */
  readonly current: JobStageView | null
}

/** 色调 + 状态词：样式留在纯函数里，外壳只负责落 class（`run-status.ts` 同一套） */
interface JobTone {
  /** @iconify 图标名（离线集合里已包含） */
  readonly icon: string
  readonly iconClassName: string
  readonly barClassName: string
  /** 收据态写在 ETA 槽里的词（`done` / `partly done` / …） */
  readonly word: string
}

type JobLabels = Pick<
  AssistantLabels,
  'jobRunning' | 'jobDone' | 'jobPartial' | 'jobFailed' | 'jobCancelled'
>

/**
 * 权重归一：非有限值 / 非正数当 0；**全零或空列表**时退回等权 ——
 * 否则总权重是 0，除出来是 NaN，进度条宽度会变成 `NaN%`。
 */
function resolveWeights(stages: readonly JobStage[]): number[] {
  const weights = stages.map(function (stage) {
    return Number.isFinite(stage.weight) && stage.weight > 0 ? stage.weight : 0
  })
  const total = weights.reduce(function (sum, weight) {
    return sum + weight
  }, 0)
  if (total <= 0) return stages.map(() => 1)
  return weights
}

/** 阶段下标钳进 `0…total`：向下取整，`NaN` 当 0；等于 total 表示「走完了」 */
function resolveStageIndex(stageIndex: number, total: number): number {
  if (!Number.isFinite(stageIndex)) return 0
  return Math.max(0, Math.min(Math.floor(stageIndex), Math.max(0, total)))
}

/** 当前阶段内的份额钳进 `0…1`（`NaN` 当 0） */
function clampStageProgress(stageProgress: number): number {
  if (!Number.isFinite(stageProgress)) return 0
  return Math.max(0, Math.min(stageProgress, 1))
}

function findJobProgress(
  stages: readonly JobStage[],
  stageIndex: number,
  stageProgress: number,
  outcome?: JobOutcome
): JobProgress {
  const weights = resolveWeights(stages)
  const totalWeight = weights.reduce(function (sum, weight) {
    return sum + weight
  }, 0)
  const index = resolveStageIndex(stageIndex, stages.length)
  const within = clampStageProgress(stageProgress)

  // 空阶段表时不算「走完了」：没有阶段就没有可收的据，保持运行态
  const walkedOut = stages.length > 0 && index >= stages.length
  const settled = outcome !== undefined || walkedOut
  const state: JobState = outcome ? outcome.status : walkedOut ? 'success' : 'running'

  // 已走过的整段 + 当前阶段按份额贡献的那一截
  const reached =
    weights.slice(0, index).reduce(function (sum, weight) {
      return sum + weight
    }, 0) + (index < stages.length ? weights[index] * within : 0)
  const raw = totalWeight === 0 ? 0 : (reached / totalWeight) * 100
  // 只有 success 把条拉满；partial / failed / cancelled 停在真正到达的位置
  const percent = state === 'success' ? 100 : Math.round(Math.max(0, Math.min(raw, 100)))

  const views = stages.map(function (stage, stageAt): JobStageView {
    return {
      id: `job-stage-${stageAt}`,
      name: stage.name,
      description: stage.description,
      weight: weights[stageAt],
      // 收据态不把进度往后推：当前那一段仍然是 active，只是条不再长
      status:
        stageAt < index ? 'done' : stageAt === index && index < stages.length ? 'active' : 'ahead'
    }
  })

  return {
    state,
    settled,
    percent,
    stageIndex: index,
    stages: views,
    current: views[index] ?? null
  }
}

/**
 * 耗时 → `<time>` 的内容：`text` 走 `formatRunDuration`（`1m 12s` / `4.8s`），
 * `iso` 是 ISO 8601 时长（元素页的 `datetime="PT72S"`）。
 * 没有耗时（`undefined` / 负数 / `NaN`）返回 `null`，槽里退回状态词。
 */
function formatElapsed(ms: number | undefined): { text: string; iso: string } | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.round(ms / 1000)
  return { text: formatRunDuration(ms) || '0s', iso: `PT${seconds}S` }
}

/** 状态 → 图标 / 色调 / 条色 / 状态词 */
function findJobTone(state: JobState, labels: JobLabels): JobTone {
  switch (state) {
    case 'success':
      return {
        icon: 'lucide:check',
        iconClassName: 'text-success',
        barClassName: 'bg-success',
        word: labels.jobDone
      }
    case 'partial':
      return {
        icon: 'lucide:circle-alert',
        iconClassName: 'text-warning',
        barClassName: 'bg-warning',
        word: labels.jobPartial
      }
    case 'failed':
      return {
        icon: 'lucide:circle-x',
        iconClassName: 'text-destructive',
        barClassName: 'bg-destructive',
        word: labels.jobFailed
      }
    case 'cancelled':
      return {
        icon: 'lucide:circle-slash',
        iconClassName: 'text-muted-foreground',
        barClassName: 'bg-muted-foreground',
        word: labels.jobCancelled
      }
    default:
      return {
        icon: 'lucide:loader-circle',
        iconClassName: 'text-primary animate-spin motion-reduce:animate-none',
        barClassName: 'bg-foreground/80',
        word: labels.jobRunning
      }
  }
}

export {
  clampStageProgress,
  findJobProgress,
  findJobTone,
  formatElapsed,
  resolveStageIndex,
  resolveWeights
}
export type {
  JobLabels,
  JobOutcome,
  JobOutcomeStatus,
  JobProgress,
  JobStage,
  JobStageStatus,
  JobStageView,
  JobState,
  JobTone
}
