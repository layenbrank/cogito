/**
 * 定时任务（`automation` / `automation_run` 表）IPC 契约。
 *
 * `owner` 为字典 value（automation_owner）：001 本机 / 002 goose / 003 云端。
 * 本机 worker 只 claim owner=001；云端任务只镜像远端状态，本机不参与排期。
 */
import { z } from 'zod'

import { DICT_VALUE } from '@/shared/ipc/specs/dict'

const OWNER = DICT_VALUE.AUTOMATION_OWNER
const RUN_AS = DICT_VALUE.AUTOMATION_RUN_AS

const AutomationOwnerSchema = z.enum([OWNER.CLIENT, OWNER.GOOSE, OWNER.CLOUD])
const AutomationRunAsSchema = z.enum([RUN_AS.USER, RUN_AS.TENANT])

const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  knowledgeBaseId: z.string().nullish(),
  /** 5 段 crontab（分 时 日 月 周） */
  schedule: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  owner: z.string(),
  runAsKind: z.string(),
  runAsUserId: z.string().nullish(),
  tenantId: z.string().nullish(),
  remoteId: z.string().nullish(),
  nextRunAt: z.number().nullish(),
  lastRunAt: z.number().nullish(),
  lastStatus: z.string().nullish(),
  lastError: z.string().nullish(),
  createdAt: z.number(),
  updatedAt: z.number()
})

const AutomationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  scheduledFor: z.number(),
  triggerKind: z.string(),
  runAsKind: z.string(),
  runAsUserId: z.string().nullish(),
  startedAt: z.number().nullish(),
  finishedAt: z.number().nullish(),
  /** automation_run_status value */
  status: z.string(),
  output: z.string().nullish(),
  error: z.string().nullish(),
  createdAt: z.number()
})

const AutomationSaveSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  prompt: z.string().min(1),
  knowledgeBaseId: z.string().nullish(),
  schedule: z.string().min(1),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
  owner: AutomationOwnerSchema.optional(),
  runAsKind: AutomationRunAsSchema.optional(),
  runAsUserId: z.string().nullish(),
  tenantId: z.string().nullish()
})

const DueRunSchema = z.object({
  automation: AutomationSchema,
  run: AutomationRunSchema
})

const AutomationDueSchema = z.object({
  runId: z.string(),
  automationId: z.string(),
  name: z.string(),
  prompt: z.string(),
  knowledgeBaseId: z.string().nullish(),
  triggerKind: z.string()
})

const FinishRunSchema = z.object({
  runId: z.string().min(1),
  output: z.string().nullish(),
  error: z.string().nullish()
})

type Automation = z.infer<typeof AutomationSchema>
type AutomationRun = z.infer<typeof AutomationRunSchema>
type AutomationSave = z.infer<typeof AutomationSaveSchema>
type AutomationDue = z.infer<typeof AutomationDueSchema>
type FinishRun = z.infer<typeof FinishRunSchema>

export {
  AutomationDueSchema,
  AutomationOwnerSchema,
  AutomationRunAsSchema,
  AutomationRunSchema,
  AutomationSaveSchema,
  AutomationSchema,
  DueRunSchema,
  FinishRunSchema
}
export type { Automation, AutomationDue, AutomationRun, AutomationSave, FinishRun }
