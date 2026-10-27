/**
 * 定时任务（`automation` / `automation_run` 表）IPC 契约。
 *
 * `owner` 说明谁来跑：`client` 由本机 worker claim；`goose` / `cloud` 只镜像远端状态，
 * 本机不参与排期（`nextRunAt` 为空）。
 */
import { z } from 'zod'

const AutomationOwnerSchema = z.enum(['client', 'goose', 'cloud'])
const AutomationRunAsSchema = z.enum(['user', 'tenant'])

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
  /** pending | running | succeeded | failed */
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
  AutomationRunSchema,
  AutomationSaveSchema,
  AutomationSchema,
  DueRunSchema,
  FinishRunSchema
}
export type { Automation, AutomationDue, AutomationRun, AutomationSave, FinishRun }
