/**
 * corex 指令编排 IPC（Tauri invoke + 进度事件）
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { CHANNELS, EVENTS } from '@/shared/ipc/channels'
import {
  ActionEntrySchema,
  CancelExecutionSchema,
  DirectiveDocumentSchema,
  DirectiveEntrySchema,
  DirectiveSaveSchema,
  ImportResultSchema,
  ImportSchema,
  InvokeSchema,
  JobViewSchema,
  JobsQuerySchema,
  JobsReplySchema,
  ListRunsReplySchema,
  ListRunsSchema,
  ProgressSchema,
  RunSchema,
  StartJobSchema,
  StatusSchema,
  StopJobSchema,
  ValidateReplySchema,
  ValidateSchema,
  type JobView,
  type JobsReply,
  type Progress
} from '@/shared/ipc/specs/sidecar'
import type { z } from 'zod'

type SidecarStatus = z.infer<typeof StatusSchema>
type ActionEntry = z.infer<typeof ActionEntrySchema>
type DirectiveDocument = z.infer<typeof DirectiveDocumentSchema>
type DirectiveEntry = z.infer<typeof DirectiveEntrySchema>
type ImportResult = z.infer<typeof ImportResultSchema>
type ListRunsReply = z.infer<typeof ListRunsReplySchema>

function parseOrThrow<T>(schema: { parse: (value: unknown) => T }, value: unknown, label: string): T {
  try {
    return schema.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: ${message}`)
  }
}

/** Tauri invoke 失败时常抛 string，不是 Error */
function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

function unwrapActions(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions)) {
    return (raw as { actions: unknown[] }).actions
  }
  return []
}

function unwrapDirectives(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray((raw as { directives?: unknown }).directives)) {
    return (raw as { directives: unknown[] }).directives
  }
  return raw
}

async function fetchStatus(): Promise<SidecarStatus> {
  try {
    const raw = await invoke(CHANNELS.SIDECAR.TO_READ)
    return parseOrThrow(StatusSchema, raw, 'sidecar 状态')
  } catch (error) {
    throw asError(error, 'sidecar 状态')
  }
}

async function fetchActions(): Promise<ActionEntry[]> {
  try {
    const raw = await invoke(CHANNELS.SIDECAR.ACTIONS)
    return parseOrThrow(ActionEntrySchema.array(), unwrapActions(raw), '动作目录')
  } catch (error) {
    throw asError(error, '动作目录')
  }
}

async function fetchDirectives(): Promise<DirectiveEntry[]> {
  try {
    const raw = await invoke(CHANNELS.SIDECAR.DIRECTIVES)
    return parseOrThrow(DirectiveEntrySchema.array(), unwrapDirectives(raw), '指令目录')
  } catch (error) {
    throw asError(error, '指令目录')
  }
}

async function fetchDirective(name: string): Promise<DirectiveDocument> {
  const raw = await invoke(CHANNELS.SIDECAR.DIRECTIVE, { input: { name } })
  return parseOrThrow(DirectiveDocumentSchema, raw, '读取指令')
}

async function saveDirective(input: z.infer<typeof DirectiveSaveSchema>): Promise<DirectiveDocument> {
  const payload = DirectiveSaveSchema.parse(input)
  const raw = await invoke(CHANNELS.SIDECAR.SAVE_DIRECTIVE, { input: payload })
  return parseOrThrow(DirectiveDocumentSchema, raw, '保存指令')
}

async function deleteDirective(name: string): Promise<void> {
  await invoke(CHANNELS.SIDECAR.DELETE_DIRECTIVE, { input: { name } })
}

async function importDirectives(input: z.infer<typeof ImportSchema>): Promise<ImportResult> {
  const payload = ImportSchema.parse(input)
  const raw = await invoke(CHANNELS.SIDECAR.IMPORT_DIRECTIVES, { input: payload })
  return parseOrThrow(ImportResultSchema, raw, '导入指令')
}

async function editDirectiveExternal(name: string): Promise<void> {
  await invoke(CHANNELS.SIDECAR.EDIT_DIRECTIVE, { input: { name } })
}

async function runDirective(input: z.infer<typeof RunSchema>): Promise<unknown> {
  const payload = RunSchema.parse(input)
  return invoke(CHANNELS.SIDECAR.RUN, { input: payload })
}

async function invokeAction(input: z.infer<typeof InvokeSchema>): Promise<unknown> {
  const payload = InvokeSchema.parse(input)
  return invoke(CHANNELS.SIDECAR.INVOKE, { input: payload })
}

async function listRuns(input: z.infer<typeof ListRunsSchema> = {}): Promise<ListRunsReply> {
  const payload = ListRunsSchema.parse(input)
  const raw = await invoke(CHANNELS.SIDECAR.LIST_RUNS, { input: payload })
  return parseOrThrow(ListRunsReplySchema, raw, '运行历史')
}

async function validateDirective(input: z.infer<typeof ValidateSchema>): Promise<{ ok: true; name: string }> {
  const payload = ValidateSchema.parse(input)
  try {
    const raw = await invoke(CHANNELS.SIDECAR.VALIDATE, { input: payload })
    return parseOrThrow(ValidateReplySchema, raw, '校验指令')
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

async function cancelExecution(targetId: number): Promise<void> {
  CancelExecutionSchema.parse({ target_id: targetId })
  await invoke(CHANNELS.SIDECAR.CANCEL_EXECUTION, {
    input: { target_id: targetId }
  })
}

async function fetchJobs(input: z.infer<typeof JobsQuerySchema> = {}): Promise<JobsReply> {
  const payload = JobsQuerySchema.parse(input)
  try {
    const raw = await invoke(CHANNELS.SIDECAR.JOBS, { input: payload })
    return parseOrThrow(JobsReplySchema, raw, '作业列表')
  } catch (error) {
    throw asError(error, '作业列表')
  }
}

async function startJob(input: z.infer<typeof StartJobSchema>): Promise<JobView> {
  const payload = StartJobSchema.parse(input)
  try {
    const raw = await invoke(CHANNELS.SIDECAR.START_JOB, { input: payload })
    return parseOrThrow(JobViewSchema, raw, '启动守护')
  } catch (error) {
    throw asError(error, '启动守护')
  }
}

async function stopJob(input: z.infer<typeof StopJobSchema>): Promise<JobView> {
  const payload = StopJobSchema.parse(input)
  try {
    const raw = await invoke(CHANNELS.SIDECAR.STOP_JOB, { input: payload })
    return parseOrThrow(JobViewSchema, raw, '停止守护')
  } catch (error) {
    throw asError(error, '停止守护')
  }
}

type ProgressListener = (frame: Progress) => void

function listenProgress(listener: ProgressListener): () => void {
  let unlisten: UnlistenFn | undefined

  void listen<unknown>(EVENTS.SIDECAR_PROGRESS, function (event) {
    const parsed = ProgressSchema.safeParse(event.payload)
    if (parsed.success) listener(parsed.data)
  }).then(function (off) {
    unlisten = off
  })

  return function () {
    unlisten?.()
  }
}

export {
  cancelExecution,
  deleteDirective,
  editDirectiveExternal,
  fetchActions,
  fetchDirective,
  fetchDirectives,
  fetchJobs,
  fetchStatus,
  importDirectives,
  invokeAction,
  listenProgress,
  listRuns,
  runDirective,
  saveDirective,
  startJob,
  stopJob,
  validateDirective
}
export type {
  ActionEntry,
  DirectiveDocument,
  DirectiveEntry,
  ImportResult,
  JobView,
  JobsReply,
  ListRunsReply,
  Progress,
  SidecarStatus
}
