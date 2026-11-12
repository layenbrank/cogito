/**
 * 定时任务（`automation` / `automation_run` 表）IPC 契约。
 *
 * `owner` 为字典 value（automation_owner）：021 本机 / 022 goose / 023 云端。
 * 本机 worker 只 claim owner=021；云端任务只镜像远端状态，本机不参与排期。
 */
import { z } from 'zod'

import { DICT_KEY, DICT_VALUE_BY_KEY } from '@/shared/ipc/specs/dict'

const OWNER = {
  CLIENT: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLIENT],
  GOOSE: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_GOOSE],
  CLOUD: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLOUD]
}
const RUN_AS = {
  USER: DICT_VALUE_BY_KEY[DICT_KEY.RUN_AS_USER],
  TENANT: DICT_VALUE_BY_KEY[DICT_KEY.RUN_AS_TENANT]
}

const AutomationOwnerSchema = z.enum([OWNER.CLIENT, OWNER.GOOSE, OWNER.CLOUD])
const AutomationRunAsSchema = z.enum([RUN_AS.USER, RUN_AS.TENANT])
const AutomationModeSchema = z.enum(['agent', 'plan', 'goal'])
/** 会话绑定：每次新建 / 固定写进某个对话 / 执行前由用户挑 */
const AutomationSessionModeSchema = z.enum(['new', 'fixed', 'ask'])
const GoalBudgetSchema = z.union([z.literal(3), z.literal(6), z.literal(12)])
/**
 * 思考强度：与 `ThinkingLevel`（`features/persist/types.ts`）同一套五档，
 * 与 goose 全局键 `GOOSE_THINKING_EFFORT` 的枚举逐字对齐（`off/low/medium/high/max`）。
 */
const AutomationThinkingSchema = z.enum(['off', 'low', 'medium', 'high', 'max'])

const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  knowledgeBaseId: z.string().nullish(),
  /** 执行目录：`agent_workspace` 的 id；空 = 家目录 */
  workspaceId: z.string().nullish(),
  /** 目录：工作区下的具体文件夹（绝对路径）；空 = 跟随工作区默认目录 */
  workspacePath: z.string().nullish(),
  /** 会话绑定：new 每次新建（缺省）/ fixed 固定对话 / ask 执行前选择 */
  sessionMode: AutomationSessionModeSchema.nullish(),
  /** 绑定的会话 id（`agent_session.id`）；sessionMode = fixed 时有值 */
  sessionId: z.string().nullish(),
  /** 执行授权：readonly（默认）/ auto；任务里没有 ask（无人值守） */
  approval: z.string(),
  /** 固定供应商；空 = 跟随当前激活 */
  providerId: z.string().nullish(),
  /** 固定模型；空 = 跟随当前激活 */
  modelId: z.string().nullish(),
  /** 单模式：agent / plan / goal */
  mode: AutomationModeSchema.default('agent'),
  /** 目标模式 / 流水线第二段轮次 */
  goalBudget: GoalBudgetSchema.default(6),
  /** 先 plan 再 goal */
  planThenGoal: z.boolean().default(false),
  /** 绑定的工作区计划文件（相对路径）；空 = 不绑定 */
  planFilePath: z.string().nullish(),
  /** 执行时的思考强度：off / low / medium（默认「标准」）/ high / max */
  thinking: AutomationThinkingSchema.default('medium'),
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
  /** 落库会话 id（`automation-<runId>`） */
  sessionId: z.string().nullish(),
  /** 当前阶段：agent / plan / goal */
  phase: AutomationModeSchema.nullish(),
  output: z.string().nullish(),
  error: z.string().nullish(),
  createdAt: z.number()
})

const AutomationSaveSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    /** 绑定计划时可空；执行依据是计划正文 */
    prompt: z.string(),
    knowledgeBaseId: z.string().nullish(),
    workspaceId: z.string().nullish(),
    /** 目录：工作区下的具体文件夹（绝对路径）；空 = 跟随工作区默认目录 */
    workspacePath: z.string().nullish(),
    /** 会话绑定：new | fixed | ask */
    sessionMode: AutomationSessionModeSchema.optional(),
    /** fixed 时必填 */
    sessionId: z.string().nullish(),
    approval: z.string().optional(),
    providerId: z.string().nullish(),
    modelId: z.string().nullish(),
    mode: AutomationModeSchema.optional(),
    goalBudget: GoalBudgetSchema.optional(),
    /** 执行时的思考强度；缺省「标准」 */
    thinking: AutomationThinkingSchema.optional(),
    planThenGoal: z.boolean().optional(),
    planFilePath: z.string().nullish(),
    schedule: z.string().min(1),
    timezone: z.string().optional(),
    enabled: z.boolean().optional(),
    owner: AutomationOwnerSchema.optional(),
    runAsKind: AutomationRunAsSchema.optional(),
    runAsUserId: z.string().nullish(),
    tenantId: z.string().nullish()
  })
  .superRefine(function (value, context) {
    const planPath = value.planFilePath?.trim()
    const hasPlan = Boolean(planPath)
    if (!hasPlan && !value.prompt.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: '任务内容不能为空'
      })
    }
    // 会话绑定：固定对话必须有 id；只有本机执行能绑（goose / 云端在客户端之外跑）
    if (value.sessionMode === 'fixed' && !value.sessionId?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['sessionId'],
        message: '绑定固定对话时必须选择一个会话'
      })
    }
    if (
      value.owner &&
      value.owner !== OWNER.CLIENT &&
      value.sessionMode &&
      value.sessionMode !== 'new'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sessionMode'],
        message: '只有本机执行的任务可以绑定会话'
      })
    }
    // 与 Rust Service::toSave / findDraftProblem 同一组绑定计划规则
    if (!hasPlan) return
    if (!value.workspaceId?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['workspaceId'],
        message: '绑定计划文件必须先指定工作目录'
      })
    }
    if (value.mode === 'plan') {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: '已绑定计划时不能再选「计划」模式（请用执行或目标去落地）'
      })
    }
    if (value.planThenGoal) {
      context.addIssue({
        code: 'custom',
        path: ['planThenGoal'],
        message: '绑定计划与「计划后执行」不能同时开启'
      })
    }
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
  workspaceId: z.string().nullish(),
  /** 目录：工作区下的具体文件夹（绝对路径）；空 = 跟随工作区默认目录 */
  workspacePath: z.string().nullish(),
  /** 会话绑定：new | fixed | ask；空 = 每次新建 */
  sessionMode: AutomationSessionModeSchema.nullish(),
  /** 执行时的思考强度；空 = 按「标准」跑 */
  thinking: AutomationThinkingSchema.nullish(),
  /** 绑定的会话 id；fixed 时有值 */
  sessionId: z.string().nullish(),
  approval: z.string(),
  providerId: z.string().nullish(),
  modelId: z.string().nullish(),
  mode: AutomationModeSchema.default('agent'),
  goalBudget: GoalBudgetSchema.default(6),
  planThenGoal: z.boolean().default(false),
  planFilePath: z.string().nullish(),
  triggerKind: z.string()
})

const FinishRunSchema = z.object({
  runId: z.string().min(1),
  output: z.string().nullish(),
  error: z.string().nullish()
})

const PatchRunSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().nullish(),
  phase: AutomationModeSchema.nullish()
})

type Automation = z.infer<typeof AutomationSchema>
type AutomationRun = z.infer<typeof AutomationRunSchema>
type AutomationSave = z.infer<typeof AutomationSaveSchema>
type AutomationDue = z.infer<typeof AutomationDueSchema>
type FinishRun = z.infer<typeof FinishRunSchema>
type PatchRun = z.infer<typeof PatchRunSchema>
type AutomationMode = z.infer<typeof AutomationModeSchema>
type AutomationSessionMode = z.infer<typeof AutomationSessionModeSchema>
type GoalBudget = z.infer<typeof GoalBudgetSchema>
type AutomationThinking = z.infer<typeof AutomationThinkingSchema>

export {
  AutomationDueSchema,
  AutomationModeSchema,
  AutomationSessionModeSchema,
  AutomationOwnerSchema,
  AutomationThinkingSchema,
  AutomationRunAsSchema,
  AutomationRunSchema,
  AutomationSaveSchema,
  AutomationSchema,
  DueRunSchema,
  FinishRunSchema,
  GoalBudgetSchema,
  PatchRunSchema
}
export type {
  Automation,
  AutomationDue,
  AutomationMode,
  AutomationRun,
  AutomationSave,
  AutomationSessionMode,
  AutomationThinking,
  FinishRun,
  GoalBudget,
  PatchRun
}
