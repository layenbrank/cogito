/**
 * 命令类工具卡「升级成任务进度卡」的判定与结局映射（纯函数，便于单测）。
 *
 * 为什么只有命令会升级：仓库里每分钟级、有明确起止、跑完还要留回执的工具调用只有它。
 * 前台命令几秒就结束，一行 `$ 命令` 足够；只有当它
 * - 是后台任务（`args.background === true`，本来就不知道什么时候完），或者
 * - 已经跑了 `JOB_COMMAND_THRESHOLD_MS` 以上（用户开始关心「还要多久」），
 * 才值得换成 assistant-ui `elements/job-progress` 那张卡。
 *
 * 判定不掺 UI，卡片（`tool-card-job.tsx`）只负责画。
 */
import type { JobOutcome } from '@cogito/design/assistant/job-progress-state'

/** 前台命令跑过这个时长就不再是「一闪而过的终端条」，而是一件要盯着看的事 */
const JOB_COMMAND_THRESHOLD_MS = 20_000

/** 命令任务只有一段阶段（就是命令本身），跑完即 `stages.length` */
const COMMAND_STAGE_TOTAL = 1

/**
 * 是否升级成任务进度卡。
 *
 * `background` 直接升级（后台任务没有可预期的结束点）；前台命令看耗时，
 * 耗时未知（`useToolCallElapsed()` 在测试 / 非运行时返回 `undefined`）时保持终端条。
 */
function isJobCommand(background: boolean, elapsedMs?: number): boolean {
  if (background) return true
  if (elapsedMs === undefined || !Number.isFinite(elapsedMs)) return false
  return elapsedMs >= JOB_COMMAND_THRESHOLD_MS
}

/**
 * 阶段下标：运行中是第 0 段（也是最后一段），结束就是「走完」——
 * `stageIndex === stages.length && 没有 outcome` 在元素口径里本身就是 success，
 * 但这里仍然给出显式 `outcome`，因为失败要靠它才画得出红色收据。
 */
function findCommandStageIndex(isRunning: boolean): number {
  return isRunning ? 0 : COMMAND_STAGE_TOTAL
}

/** 结局：运行中没有收据；结束按 `isError` 分成失败 / 成功 */
function findCommandOutcome(input: {
  isRunning: boolean
  isError: boolean
}): JobOutcome | undefined {
  if (input.isRunning) return undefined
  return { status: input.isError ? 'failed' : 'success' }
}

export {
  COMMAND_STAGE_TOTAL,
  JOB_COMMAND_THRESHOLD_MS,
  findCommandOutcome,
  findCommandStageIndex,
  isJobCommand
}
