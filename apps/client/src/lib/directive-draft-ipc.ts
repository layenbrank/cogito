/**
 * 指令草稿 IPC（写入 SQLite 的 directive_draft 表）。
 *
 * 注意：这里**不写 corex.db**。确认草稿时才调 `saveDirective`（daemon 是唯一写者）。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  DirectiveDraftSchema,
  type DirectiveDraft,
  type DraftSave,
  type DraftStatus
} from '@/shared/ipc/specs/directive-draft'

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function saveDraft(input: DraftSave): Promise<DirectiveDraft> {
  try {
    const raw = await invoke(CHANNELS.DIRECTIVE_DRAFT.SAVE, { input })
    return DirectiveDraftSchema.parse(raw)
  } catch (error) {
    throw asError(error, '保存指令草稿失败')
  }
}

async function listDrafts(status?: string, limit?: number): Promise<DirectiveDraft[]> {
  try {
    const raw = await invoke(CHANNELS.DIRECTIVE_DRAFT.LIST, { status, limit })
    return DirectiveDraftSchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '读取指令草稿失败')
  }
}

async function writeDraftStatus(input: DraftStatus): Promise<DirectiveDraft> {
  try {
    const raw = await invoke(CHANNELS.DIRECTIVE_DRAFT.SET_STATUS, { input })
    return DirectiveDraftSchema.parse(raw)
  } catch (error) {
    throw asError(error, '更新指令草稿状态失败')
  }
}

async function removeDraft(id: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.DIRECTIVE_DRAFT.REMOVE, { id })
  } catch (error) {
    throw asError(error, '删除指令草稿失败')
  }
}

export { listDrafts, removeDraft, saveDraft, writeDraftStatus }
export type { DirectiveDraft, DraftSave, DraftStatus }
