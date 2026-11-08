/**
 * 定时任务 IPC（写入本地 SQLite 的 automation / automation_run）。
 *
 * 执行不在这一层：worker claim 后发 `automation:due`，前端跑完才调 `finishRun`。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  AutomationRunSchema,
  AutomationSchema,
  DueRunSchema,
  type Automation,
  type AutomationRun,
  type AutomationSave,
  type FinishRun,
  type PatchRun
} from '@/shared/ipc/specs/automation'

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function saveAutomation(input: AutomationSave): Promise<Automation> {
  try {
    return AutomationSchema.parse(await invoke(CHANNELS.AUTOMATION.SAVE, { input }))
  } catch (error) {
    throw asError(error, '保存定时任务失败')
  }
}

async function listAutomations(): Promise<Automation[]> {
  try {
    return AutomationSchema.array().parse((await invoke(CHANNELS.AUTOMATION.LIST)) ?? [])
  } catch (error) {
    throw asError(error, '读取定时任务失败')
  }
}

async function writeAutomationEnabled(id: string, enabled: boolean): Promise<Automation> {
  try {
    return AutomationSchema.parse(
      await invoke(CHANNELS.AUTOMATION.SET_ENABLED, { id, enabled })
    )
  } catch (error) {
    throw asError(error, '切换定时任务状态失败')
  }
}

async function removeAutomation(id: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.AUTOMATION.REMOVE, { id })
  } catch (error) {
    throw asError(error, '删除定时任务失败')
  }
}

/** 返回 `null` 表示这次执行交给了 goose（本地不落执行记录，记录在 goose 侧） */
async function runAutomationNow(id: string): Promise<{ automation: Automation; run: AutomationRun } | null> {
  try {
    const raw = await invoke(CHANNELS.AUTOMATION.RUN_NOW, { id })
    return raw ? DueRunSchema.parse(raw) : null
  } catch (error) {
    throw asError(error, '立即执行失败')
  }
}

/** 真正开跑时补写 startedAt：排队时间不算耗时，也不会在排队时被判「陈旧」 */
async function touchAutomationRun(runId: string): Promise<AutomationRun> {
  try {
    return AutomationRunSchema.parse(await invoke(CHANNELS.AUTOMATION.TOUCH_RUN, { runId }))
  } catch (error) {
    throw asError(error, '标记执行开始失败')
  }
}

async function finishAutomationRun(input: FinishRun): Promise<AutomationRun> {
  try {
    return AutomationRunSchema.parse(await invoke(CHANNELS.AUTOMATION.FINISH_RUN, { input }))
  } catch (error) {
    throw asError(error, '回写执行结果失败')
  }
}

/** 补写会话回链 / 阶段（开会话后与流水线切阶段时调用） */
async function patchAutomationRun(input: PatchRun): Promise<AutomationRun> {
  try {
    return AutomationRunSchema.parse(await invoke(CHANNELS.AUTOMATION.PATCH_RUN, { input }))
  } catch (error) {
    throw asError(error, '更新执行记录失败')
  }
}

/**
 * 执行记录。`automationId` 传 `null` = 跨任务取最近 N 条（任务页的「全部记录」）。
 */
async function listAutomationRuns(
  automationId?: string | null,
  limit?: number
): Promise<AutomationRun[]> {
  try {
    return AutomationRunSchema.array().parse(
      (await invoke(CHANNELS.AUTOMATION.RUNS, { automationId: automationId ?? null, limit })) ?? []
    )
  } catch (error) {
    throw asError(error, '读取执行记录失败')
  }
}

export {
  finishAutomationRun,
  listAutomationRuns,
  listAutomations,
  patchAutomationRun,
  removeAutomation,
  runAutomationNow,
  saveAutomation,
  touchAutomationRun,
  writeAutomationEnabled
}
export type { Automation, AutomationRun, AutomationSave, FinishRun, PatchRun }
