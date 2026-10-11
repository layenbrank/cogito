import { z } from 'zod'

import { CHANNELS } from '@/shared/ipc/channels'

const StatusSchema = z.object({
  isReady: z.boolean(),
  version: z.string(),
  actions: z.array(z.string()),
  hasCorex: z.boolean(),
  dataDir: z.string(),
  database: z.string(),
  isBundled: z.boolean()
})

const BUCKETS = ['system', 'network', 'data', 'ui', 'logic', 'plugin'] as const
const BucketSchema = z.enum(BUCKETS)

type Bucket = z.infer<typeof BucketSchema>

const ActionParamSchema = z.object({
  name: z.string(),
  ty: z.string(),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.unknown().optional()
})

const ActionEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  bucket: BucketSchema,
  params: z.array(ActionParamSchema).default([]),
  tags: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  input_schema: z.unknown().optional()
})

const RunIdSchema = z.string().min(1)

const ProgressSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('started'),
    runId: RunIdSchema,
    requestId: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('step_start'),
    runId: RunIdSchema,
    step: z.string(),
    action: z.string(),
    seq: z.number().int().optional(),
    path: z.array(z.string()).optional(),
    branch_index: z.number().int().optional(),
    run_id: z.string().optional()
  }),
  z.object({
    kind: z.literal('step_progress'),
    runId: RunIdSchema,
    step: z.string(),
    action: z.string(),
    done: z.number().optional(),
    total: z.number().nullable().optional(),
    unit: z.enum(['bytes', 'items']).optional(),
    path: z.array(z.string()).optional()
  }),
  z.object({
    kind: z.literal('step_output'),
    runId: RunIdSchema,
    step: z.string(),
    action: z.string(),
    stream: z.enum(['stdout', 'stderr']).optional(),
    text: z.string().optional(),
    path: z.array(z.string()).optional()
  }),
  z.object({
    kind: z.literal('step_end'),
    runId: RunIdSchema,
    step: z.string(),
    action: z.string(),
    took_ms: z.number().optional(),
    ok: z.boolean().optional(),
    path: z.array(z.string()).optional()
  })
])

const InvokeSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  runId: RunIdSchema
})

const RunSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
  runId: RunIdSchema
})

const DirectiveNameSchema = z.object({ name: z.string().min(1) })

const INVALID_DIRECTIVE_NAME = /[\\/]|\.\./

function isValidDirectiveName(name: string): boolean {
  return name.length > 0 && !INVALID_DIRECTIVE_NAME.test(name)
}

const DirectiveSummarySchema = z.object({
  description: z.string(),
  step_count: z.number().int(),
  input_count: z.number().int(),
  trigger_count: z.number().int(),
  has_cron: z.boolean().default(false),
  has_watch: z.boolean().default(false)
})

const RunOutcomeSchema = z.object({
  started_at_ms: z.number(),
  ended_at_ms: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
  duration_ms: z.number()
})

const DirectiveRunSchema = RunOutcomeSchema.extend({
  run_count: z.number().int(),
  failed_count: z.number().int()
})

const DirectiveEntrySchema = z.object({
  name: z.string(),
  folder: z.string().nullable(),
  source: z.string().nullable(),
  visible: z.boolean().default(true),
  updated_at_ms: z.number(),
  bucket: BucketSchema.nullable(),
  summary: DirectiveSummarySchema.nullable(),
  last_run: DirectiveRunSchema.optional()
})

const DirectiveInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional()
})

type Condition =
  | string
  | {
      eq?: [unknown, unknown]
      ne?: [unknown, unknown]
      gt?: [unknown, unknown]
      lt?: [unknown, unknown]
      contains?: [unknown, unknown]
      and?: Condition[]
      or?: Condition[]
      not?: Condition
    }

const ConditionSchema: z.ZodType<Condition> = z.lazy(function () {
  return z.union([
    z.string(),
    z
      .object({
        eq: z.tuple([z.unknown(), z.unknown()]).optional(),
        ne: z.tuple([z.unknown(), z.unknown()]).optional(),
        gt: z.tuple([z.unknown(), z.unknown()]).optional(),
        lt: z.tuple([z.unknown(), z.unknown()]).optional(),
        contains: z.tuple([z.unknown(), z.unknown()]).optional(),
        and: z.array(ConditionSchema).optional(),
        or: z.array(ConditionSchema).optional(),
        not: ConditionSchema.optional()
      })
      .catchall(z.unknown())
  ])
})

type OnError = 'abort' | 'continue' | 'skip'

type ActionStep = {
  id: string
  action: string
  params?: Record<string, unknown>
  save_to?: string
  when?: Condition
  on_error?: OnError
  retry?: number
}

type IfStep = {
  id: string
  if: Condition
  then: Step[]
  else?: Step[]
}

type RepeatStep = {
  id: string
  repeat: { count?: number; each?: string; as?: string; index?: string }
  max_concurrency?: number
  steps: Step[]
}

type ParallelStep = {
  id: string
  parallel: Step[]
  max_concurrency?: number
}

type StepsStep = {
  id?: string
  steps: Step[]
}

type Step = ActionStep | IfStep | RepeatStep | ParallelStep | StepsStep

const ActionStepSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    save_to: z.string().optional(),
    when: ConditionSchema.optional(),
    on_error: z.enum(['abort', 'continue', 'skip']).optional(),
    retry: z.number().int().nonnegative().optional()
  })
  .catchall(z.unknown())

const StepSchema: z.ZodType<Step> = z.lazy(function () {
  return z.union([
    ActionStepSchema,
    z
      .object({
        id: z.string(),
        if: ConditionSchema,
        then: z.array(StepSchema),
        else: z.array(StepSchema).optional()
      })
      .catchall(z.unknown()),
    z
      .object({
        id: z.string(),
        repeat: z.object({
          count: z.number().int().nonnegative().optional(),
          each: z.string().optional(),
          as: z.string().optional(),
          index: z.string().optional()
        }),
        max_concurrency: z.number().int().nonnegative().optional(),
        steps: z.array(StepSchema)
      })
      .catchall(z.unknown()),
    z
      .object({
        id: z.string(),
        parallel: z.array(StepSchema),
        max_concurrency: z.number().int().nonnegative().optional()
      })
      .catchall(z.unknown()),
    z
      .object({
        id: z.string().optional(),
        steps: z.array(StepSchema)
      })
      .catchall(z.unknown())
  ])
})

const PermissionsSchema = z.object({
  capture: z.boolean().optional(),
  clipboard: z.boolean().optional(),
  filesystem: z.boolean().optional(),
  network: z.boolean().optional(),
  notifications: z.boolean().optional(),
  secret: z.boolean().optional(),
  shell: z.boolean().optional(),
  ui: z.boolean().optional()
})

const TriggerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('cron'),
      expr: z.string(),
      timezone: z.string().optional()
    })
    .catchall(z.unknown()),
  z
    .object({
      type: z.literal('watch'),
      paths: z.array(z.string()).min(1),
      includes: z.array(z.string()).optional(),
      excludes: z.array(z.string()).optional(),
      events: z.array(z.enum(['create', 'modify', 'remove', 'access'])).optional(),
      debounce_ms: z.number().int().nonnegative().optional(),
      debounce: z.enum(['leading', 'trailing', 'both']).optional(),
      throttle_ms: z.number().int().positive().optional(),
      throttle: z.enum(['leading', 'trailing', 'both']).optional(),
      poll: z.boolean().optional(),
      immediate: z.boolean().optional()
    })
    .catchall(z.unknown())
])

const DirectiveContentSchema = z
  .object({
    name: z.string(),
    description: z.string().default(''),
    version: z
      .string()
      .nullish()
      .transform(function (value) {
        return value ?? ''
      }),
    bucket: BucketSchema.nullable().optional(),
    inputs: z.array(DirectiveInputSchema).default([]),
    variables: z.record(z.string(), z.unknown()).optional(),
    permissions: PermissionsSchema.optional(),
    triggers: z.array(TriggerSchema).optional(),
    on_error: z.enum(['abort', 'continue', 'skip']).optional(),
    steps: z.array(StepSchema).default([])
  })
  .catchall(z.unknown())

const DirectiveDocumentSchema = z.object({
  name: z.string(),
  folder: z.string().nullable(),
  source: z.string().nullable(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  yaml: z.string(),
  definition: DirectiveContentSchema
})

const DirectiveSaveSchema = z.object({
  definition: DirectiveContentSchema,
  original_name: z.string().optional()
})

const ImportStatusSchema = z.enum(['created', 'updated', 'skipped', 'failed'])

const ImportEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  status: ImportStatusSchema,
  error: z.string().optional()
})

const ImportResultSchema = z.object({
  entries: z.array(ImportEntrySchema),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int()
})

const ImportSchema = z.object({
  path: z.string().min(1),
  folder: z.string().optional(),
  is_overwrite: z.boolean().optional(),
  is_dry_run: z.boolean().optional()
})

const ValidateSchema = z.object({
  definition: DirectiveContentSchema,
  strict: z.boolean().optional()
})

const ValidateReplySchema = z.object({
  ok: z.literal(true),
  name: z.string()
})

const ListRunsSchema = z.object({
  name: z.string().optional(),
  limit: z.number().int().positive().optional()
})

const HistoryEntrySchema = RunOutcomeSchema.extend({
  directive: z.string()
})

const ListRunsReplySchema = z.object({
  is_history_enabled: z.boolean(),
  entries: z.array(HistoryEntrySchema)
})

const CancelExecutionSchema = z.object({
  target_id: z.number().int().nonnegative()
})

const JobKindSchema = z.enum(['cron', 'watch'])

const JobViewSchema = z.object({
  kind: JobKindSchema,
  name: z.string(),
  id: z.string(),
  pid: z.number().int(),
  is_alive: z.boolean(),
  started_at_ms: z.number().optional(),
  directive_path: z.string()
})

const JobsQuerySchema = z.object({
  kind: JobKindSchema.optional()
})

const JobsReplySchema = z.object({
  jobs: z.array(JobViewSchema)
})

const StartJobSchema = z.object({
  kind: JobKindSchema,
  name: z.string().min(1),
  immediate: z.boolean().optional()
})

const StopJobSchema = z.object({
  kind: JobKindSchema,
  name: z.string().min(1),
  force: z.boolean().optional()
})

type DirectiveContent = z.infer<typeof DirectiveContentSchema>
type DirectiveDocument = z.infer<typeof DirectiveDocumentSchema>
type DirectiveEntry = z.infer<typeof DirectiveEntrySchema>
type ImportResult = z.infer<typeof ImportResultSchema>
type DirectiveRun = z.infer<typeof DirectiveRunSchema>
type DirectiveInput = z.infer<typeof DirectiveInputSchema>
type DirectiveStep = Step
type Progress = z.infer<typeof ProgressSchema>
type ActionEntry = z.infer<typeof ActionEntrySchema>
type ListRunsReply = z.infer<typeof ListRunsReplySchema>
type JobKind = z.infer<typeof JobKindSchema>
type JobView = z.infer<typeof JobViewSchema>
type JobsReply = z.infer<typeof JobsReplySchema>

const SIDECAR_CHANNELS = CHANNELS.SIDECAR

export {
  ActionEntrySchema,
  ActionParamSchema,
  ActionStepSchema,
  BUCKETS,
  BucketSchema,
  CancelExecutionSchema,
  ConditionSchema,
  DirectiveContentSchema,
  DirectiveDocumentSchema,
  DirectiveEntrySchema,
  DirectiveInputSchema,
  DirectiveNameSchema,
  DirectiveRunSchema,
  DirectiveSaveSchema,
  DirectiveSummarySchema,
  HistoryEntrySchema,
  ImportEntrySchema,
  ImportResultSchema,
  ImportSchema,
  ImportStatusSchema,
  InvokeSchema,
  isValidDirectiveName,
  JobKindSchema,
  JobViewSchema,
  JobsQuerySchema,
  JobsReplySchema,
  ListRunsReplySchema,
  ListRunsSchema,
  PermissionsSchema,
  ProgressSchema,
  RunOutcomeSchema,
  RunSchema,
  SIDECAR_CHANNELS,
  StartJobSchema,
  StatusSchema,
  StepSchema,
  StopJobSchema,
  TriggerSchema,
  ValidateReplySchema,
  ValidateSchema
}
export type {
  ActionEntry,
  Bucket,
  Condition,
  DirectiveContent,
  DirectiveDocument,
  DirectiveEntry,
  DirectiveInput,
  DirectiveRun,
  DirectiveStep,
  IfStep,
  ImportResult,
  JobKind,
  JobView,
  JobsReply,
  ListRunsReply,
  OnError,
  ParallelStep,
  Progress,
  RepeatStep,
  Step,
  StepsStep
}
