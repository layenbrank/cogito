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
  type FinishRun
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

async function setAutomationEnabled(id: string, enabled: boolean): Promise<Automation> {
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

async function finishAutomationRun(input: FinishRun): Promise<AutomationRun> {
  try {
    return AutomationRunSchema.parse(await invoke(CHANNELS.AUTOMATION.FINISH_RUN, { input }))
  } catch (error) {
    throw asError(error, '回写执行结果失败')
  }
}

async function listAutomationRuns(automationId: string, limit?: number): Promise<AutomationRun[]> {
  try {
    return AutomationRunSchema.array().parse(
      (await invoke(CHANNELS.AUTOMATION.RUNS, { automationId, limit })) ?? []
    )
  } catch (error) {
    throw asError(error, '读取执行记录失败')
  }
}

export {
  finishAutomationRun,
  listAutomationRuns,
  listAutomations,
  removeAutomation,
  runAutomationNow,
  saveAutomation,
  setAutomationEnabled
}
export type { Automation, AutomationRun, AutomationSave, FinishRun }
