/**
 * 任务页的纯逻辑：三源合并、按执行方分组、排序、状态聚合、记录筛选、表单草稿互转。
 *
 * 全部无副作用、不碰 IPC 与 React —— 单测直接调（`model.test.ts`）。
 * 「谁先谁后」「什么时候算停用」这类口径写在这里一处，列表与详情共用。
 */
import { isValidSchedule } from '@/features/automation/describe-schedule'
import { parseAutomationThinking } from '@/features/automation/run-plan'
import { THINKING_OPTIONS } from '@/features/agent/model/model-prefs'
import type { ThinkingLevel } from '@/features/persist'
import { GOAL_BUDGET_OPTIONS } from '@/features/agent/goal-run'
import type {
  Automation,
  AutomationMode,
  AutomationRun,
  AutomationSave,
  AutomationSessionMode,
  GoalBudget
} from '@/shared/ipc/specs/automation'
import { DICT_KEY, DICT_VALUE_BY_KEY } from '@/shared/ipc/specs/dict'

const OWNER = {
  CLIENT: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLIENT],
  GOOSE: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_GOOSE],
  CLOUD: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLOUD]
}

const RUN_STATUS = {
  RUNNING: DICT_VALUE_BY_KEY[DICT_KEY.RUN_RUNNING],
  SUCCEEDED: DICT_VALUE_BY_KEY[DICT_KEY.RUN_SUCCEEDED],
  FAILED: DICT_VALUE_BY_KEY[DICT_KEY.RUN_FAILED]
}

/** 组顺序 = 执行语义由「本地」到「远端」：本机 → goose → 服务端 → 其它 */
const OWNER_ORDER: readonly string[] = [OWNER.CLIENT, OWNER.GOOSE, OWNER.CLOUD]

/** 每种 owner 的行为差异必须写在界面上：三源同列很容易被误读成「都一样」 */
const OWNER_HINT: Record<string, string> = {
  [OWNER.CLIENT]: '关掉应用就不跑',
  [OWNER.GOOSE]: '排期在 goose，记录看 goose 会话',
  [OWNER.CLOUD]: '关掉客户端也照跑；不能手动触发'
}

type TaskBadgeTone = 'running' | 'ok' | 'fail' | 'off' | 'idle'

interface TaskBadge {
  tone: TaskBadgeTone
  label: string
}

interface TaskGroup {
  owner: string
  items: Automation[]
}

type RunFilter = 'all' | 'succeeded' | 'failed' | 'running'

/** 任务表单草稿：与服务端 `AutomationInput` 一一对应，只多一个 `id`（null = 新建） */
interface TaskDraft {
  id: string | null
  name: string
  prompt: string
  schedule: string
  timezone: string
  owner: string
  workspaceId: string | null
  /** 工作区下具体目录（文件夹绝对路径）；null = 跟随工作区默认目录 */
  workspacePath: string | null
  /** 会话绑定：new 每次新建 / fixed 固定对话 / ask 执行前选择 */
  sessionMode: AutomationSessionMode
  /** fixed 时绑定到的会话 id */
  sessionId: string | null
  approval: 'readonly' | 'auto'
  providerId: string | null
  modelId: string | null
  mode: AutomationMode
  goalBudget: GoalBudget
  planThenGoal: boolean
  /** 工作区相对路径；空 = 不绑定已有计划 */
  planFilePath: string | null
  knowledgeBaseId: string | null
  /** 执行时的思考强度（默认「标准」）：只作用于本任务起的会话，不动用户自己的模型偏好 */
  thinking: ThinkingLevel
  enabled: boolean
}

const MODE_OPTIONS: ReadonlyArray<{ value: AutomationMode; label: string }> = [
  { value: 'agent', label: '执行' },
  { value: 'plan', label: '计划' },
  { value: 'goal', label: '目标' }
]

function parseMode(value: string | null | undefined): AutomationMode {
  if (value === 'plan' || value === 'goal' || value === 'agent') return value
  return 'agent'
}

function parseGoalBudget(value: number | null | undefined): GoalBudget {
  if (value === 3 || value === 6 || value === 12) return value
  return 6
}

const DEFAULT_TIMEZONE = 'Asia/Shanghai'

const SESSION_MODE_OPTIONS: ReadonlyArray<{ value: AutomationSessionMode; label: string }> = [
  { value: 'new', label: '每次新建对话' },
  { value: 'fixed', label: '固定对话' },
  { value: 'ask', label: '执行前选择' }
]

function parseSessionMode(value: string | null | undefined): AutomationSessionMode {
  if (value === 'fixed' || value === 'ask' || value === 'new') return value
  return 'new'
}

function findOwnerHint(owner: string): string {
  return OWNER_HINT[owner] ?? ''
}

function isCloudTask(item: Pick<Automation, 'owner'>): boolean {
  return item.owner === OWNER.CLOUD
}

/** 服务端任务手动触发还没有接口（服务端只有 list/save/patch/delete） */
function canRunNow(item: Pick<Automation, 'owner'>): boolean {
  return item.owner !== OWNER.CLOUD
}

/**
 * 排序键：启用且有排期的按时间从近到远排在前；停用 / 没有排期的沉到后面。
 *
 * 用 `Number.POSITIVE_INFINITY` 而不是 0：`0` 会被当成「1970 年到期」，全是停用任务时
 * 顺序会跟名字无关地乱跳。
 */
function findSortKey(item: Automation): number {
  if (!item.enabled) return Number.POSITIVE_INFINITY
  return item.nextRunAt ?? Number.POSITIVE_INFINITY
}

function compareTasks(left: Automation, right: Automation): number {
  const leftKey = findSortKey(left)
  const rightKey = findSortKey(right)
  const leftTimed = Number.isFinite(leftKey)
  const rightTimed = Number.isFinite(rightKey)
  if (leftTimed && rightTimed && leftKey !== rightKey) return leftKey - rightKey
  // 有排期的整体排在没排期的前面（停用 / 服务端未排期）
  if (leftTimed !== rightTimed) return leftTimed ? -1 : 1
  return left.name.localeCompare(right.name, 'zh-CN')
}

/** 本机 + 服务端两份列表 → 按 owner 分组、组内排序（空组不出现） */
function buildTaskGroups(client: Automation[], cloud: Automation[]): TaskGroup[] {
  const all = [...client, ...cloud]
  const buckets = new Map<string, Automation[]>()
  for (const item of all) {
    const key = OWNER_ORDER.includes(item.owner) ? item.owner : 'other'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const order = [...OWNER_ORDER, 'other']
  return order
    .filter(function (owner) {
      return (buckets.get(owner)?.length ?? 0) > 0
    })
    .map(function (owner) {
      return {
        owner,
        items: [...(buckets.get(owner) ?? [])].sort(compareTasks)
      }
    })
}

/** 一行的状态徽标：执行中 > 已停用 > 上次结果 */
function findTaskBadge(
  item: Pick<Automation, 'enabled' | 'lastStatus'>,
  isRunning: boolean
): TaskBadge {
  if (isRunning) return { tone: 'running', label: '执行中' }
  if (!item.enabled) return { tone: 'off', label: '已停用' }
  if (item.lastStatus === RUN_STATUS.SUCCEEDED) return { tone: 'ok', label: '成功' }
  if (item.lastStatus === RUN_STATUS.FAILED) return { tone: 'fail', label: '失败' }
  if (item.lastStatus === RUN_STATUS.RUNNING) return { tone: 'running', label: '执行中' }
  return { tone: 'idle', label: '未执行' }
}

function filterRuns(runs: AutomationRun[], filter: RunFilter): AutomationRun[] {
  if (filter === 'all') return runs
  const wanted =
    filter === 'succeeded'
      ? RUN_STATUS.SUCCEEDED
      : filter === 'failed'
        ? RUN_STATUS.FAILED
        : RUN_STATUS.RUNNING
  return runs.filter(function (run) {
    return run.status === wanted
  })
}

/** 排期卡上的一条「最近执行」：只留渲染需要的三样（格式由界面决定） */
interface RecentRun {
  id: string
  atMs: number
  ok: boolean
}

/**
 * 卡片上「最近执行」用的几条记录：优先真实记录（按开始时间倒序），
 * 一条都没有时退回任务上的上一次执行 —— 列表不为三行字再拉 N 次接口。
 * 执行中的那条不进历史：它还没结果，卡底的「执行中」已经表达了。
 */
function findRecentRuns(
  item: Pick<Automation, 'id' | 'lastRunAt' | 'lastStatus'>,
  runs: readonly AutomationRun[],
  limit = 3
): RecentRun[] {
  const mine = runs
    .filter(function (run) {
      return run.automationId === item.id && run.status !== RUN_STATUS.RUNNING
    })
    .sort(function (left, right) {
      return (right.startedAt ?? right.createdAt) - (left.startedAt ?? left.createdAt)
    })
  if (mine.length > 0) {
    return mine.slice(0, limit).map(function (run) {
      return {
        id: run.id,
        atMs: run.startedAt ?? run.createdAt,
        ok: run.status === RUN_STATUS.SUCCEEDED
      }
    })
  }
  // 上次执行还在跑：历史留空，免得把「正在跑」画成叉
  if (!item.lastRunAt || item.lastStatus === RUN_STATUS.RUNNING) return []
  return [
    {
      id: item.id + '-last',
      atMs: item.lastRunAt,
      ok: item.lastStatus === RUN_STATUS.SUCCEEDED
    }
  ]
}

/** 耗时（毫秒）：没跑完（没有 finishedAt）就没有耗时 */
function findRunDuration(run: Pick<AutomationRun, 'startedAt' | 'finishedAt'>): number | null {
  if (!run.startedAt || !run.finishedAt) return null
  const delta = run.finishedAt - run.startedAt
  return delta >= 0 ? delta : null
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} 毫秒`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`
}

/** 记录汇总：条数 / 失败数 / 最近一次时间 */
function summarizeRuns(runs: AutomationRun[]): {
  total: number
  failed: number
  lastAt: number | null
} {
  let lastAt: number | null = null
  let failed = 0
  for (const run of runs) {
    if (run.status === RUN_STATUS.FAILED) failed += 1
    const at = run.startedAt ?? run.createdAt
    if (lastAt === null || at > lastAt) lastAt = at
  }
  return { total: runs.length, failed, lastAt }
}

function toDraft(item: Automation): TaskDraft {
  return {
    id: item.id,
    name: item.name,
    prompt: item.prompt,
    schedule: item.schedule,
    timezone: item.timezone,
    owner: item.owner,
    workspaceId: item.workspaceId ?? null,
    workspacePath: item.workspacePath ?? null,
    sessionMode: parseSessionMode(item.sessionMode),
    sessionId: item.sessionId ?? null,
    approval: item.approval === 'auto' ? 'auto' : 'readonly',
    providerId: item.providerId ?? null,
    modelId: item.modelId ?? null,
    mode: parseMode(item.mode),
    goalBudget: parseGoalBudget(item.goalBudget),
    planThenGoal: Boolean(item.planThenGoal) && !item.planFilePath,
    planFilePath: item.planFilePath ?? null,
    knowledgeBaseId: item.knowledgeBaseId ?? null,
    thinking: parseAutomationThinking(item.thinking),
    enabled: item.enabled
  }
}

function createDraft(owner: string): TaskDraft {
  return {
    id: null,
    name: '',
    prompt: '',
    schedule: '0 9 * * *',
    timezone: DEFAULT_TIMEZONE,
    owner,
    workspaceId: null,
    workspacePath: null,
    sessionMode: 'new',
    sessionId: null,
    approval: 'readonly',
    providerId: null,
    modelId: null,
    mode: 'agent',
    goalBudget: 6,
    planThenGoal: false,
    planFilePath: null,
    knowledgeBaseId: null,
    thinking: 'medium',
    enabled: true
  }
}

/**
 * 草稿能否保存：空名 / 空指令 / 空表达式不放过；自动批准必须有工作目录
 * （与服务端 `Service::toSave` 同一条规则，前端先拦一次省一个来回）。
 */
function findDraftProblem(draft: TaskDraft): string | null {
  if (!draft.name.trim()) return '任务名称不能为空'
  const hasPlan = Boolean(draft.planFilePath?.trim())
  if (!hasPlan && !draft.prompt.trim()) return '任务内容不能为空'
  if (!draft.schedule.trim()) return '定时表达式不能为空'
  if (!isValidSchedule(draft.schedule)) {
    return '时间表达式不合法：用上面的可视化选项重新选一次即可'
  }
  if (draft.approval === 'auto' && !draft.workspaceId) {
    return '自动批准必须先指定工作目录（把写入范围限制在目录内）'
  }
  if (draft.workspacePath && !draft.workspaceId) {
    return '指定目录时必须先选工作区'
  }
  if (draft.sessionMode === 'fixed' && !draft.sessionId?.trim()) {
    return '绑定固定对话时必须选择一个会话'
  }
  if (draft.sessionMode !== 'new' && draft.owner !== OWNER.CLIENT) {
    return '只有本机执行的任务可以绑定会话'
  }
  if (hasPlan && !draft.workspaceId) {
    return '绑定计划文件必须先指定工作目录'
  }
  if (hasPlan && draft.mode === 'plan') {
    return '已绑定计划时不能再选「计划」模式（请用执行或目标去落地）'
  }
  if (hasPlan && draft.planThenGoal) {
    return '绑定计划与「计划后执行」不能同时开启'
  }
  const hasProvider = Boolean(draft.providerId)
  const hasModel = Boolean(draft.modelId)
  if (hasProvider !== hasModel) {
    return '固定模型需要同时指定供应商与模型，或都留空跟随当前'
  }
  if (!GOAL_BUDGET_OPTIONS.includes(draft.goalBudget)) {
    return '目标轮次只能是 3 / 6 / 12'
  }
  return null
}

/**
 * 草稿的 owner 来自字典 value（宽 string），落库前收窄回契约的三选一。
 * 认不出来就当本机：宁可少跑，也不要把一行未知 owner 塞进列表里排不掉。
 */
function toOwner(value: string): NonNullable<AutomationSave['owner']> {
  const known: readonly string[] = [OWNER.CLIENT, OWNER.GOOSE, OWNER.CLOUD]
  return (known.includes(value) ? value : OWNER.CLIENT) as NonNullable<AutomationSave['owner']>
}

/** 草稿 → 保存入参；服务端任务不落本地，只带排期与提示词 */
function toSaveInput(draft: TaskDraft): AutomationSave {
  return {
    id: draft.id ?? undefined,
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    schedule: draft.schedule.trim(),
    timezone: draft.timezone.trim() || DEFAULT_TIMEZONE,
    owner: toOwner(draft.owner),
    workspaceId: draft.workspaceId,
    workspacePath: draft.workspacePath,
    sessionMode: draft.sessionMode,
    // 只有 fixed 带 id：切回「每次新建」后旧 id 不该继续传下去
    sessionId: draft.sessionMode === 'fixed' ? draft.sessionId : null,
    approval: draft.approval,
    providerId: draft.providerId,
    modelId: draft.modelId,
    mode: draft.mode,
    goalBudget: draft.goalBudget,
    planThenGoal: draft.planFilePath ? false : draft.planThenGoal,
    planFilePath: draft.planFilePath,
    knowledgeBaseId: draft.knowledgeBaseId,
    thinking: draft.thinking,
    enabled: draft.enabled
  }
}

/** 记录上的阶段文案（任务面板徽标 / 记录列表） */
function findPhaseLabel(phase: string | null | undefined): string | null {
  if (phase === 'plan') return '计划中'
  if (phase === 'goal') return '目标推进'
  if (phase === 'agent') return '执行中'
  return null
}

type TaskModeFields = Pick<Automation, 'mode' | 'goalBudget' | 'planThenGoal' | 'planFilePath'>

/** 详情 meta：模式一行（含绑定计划 / 流水线） */
function findTaskModeLabel(item: TaskModeFields): string {
  const budget = item.goalBudget ?? 6
  if (item.planFilePath) {
    return item.mode === 'agent' ? '绑定计划 · 执行' : `绑定计划 · 目标 · ${budget} 轮`
  }
  if (item.planThenGoal) return `计划→目标 · ${budget} 轮`
  if (item.mode === 'plan') return '计划'
  if (item.mode === 'goal') return `目标 · ${budget} 轮`
  return '执行'
}

/** 详情 / 卡片上的会话绑定文案（未绑定时返回空串，不占位） */
function findSessionModeLabel(item: Pick<Automation, 'sessionMode' | 'sessionId'>): string {
  const mode = parseSessionMode(item.sessionMode)
  if (mode === 'fixed') return '固定对话'
  if (mode === 'ask') return '执行前选择对话'
  return ''
}

/** 思考强度文案：与 composer / 右栏同一份取的 `THINKING_OPTIONS`，认不出按「标准」 */
function findThinkingLabel(value: string | null | undefined): string {
  const level = parseAutomationThinking(value)
  const found = THINKING_OPTIONS.find(function (option) {
    return option.value === level
  })
  return found?.label ?? '标准'
}

/** 列表行后缀：空字符串 = 默认执行、不额外标 */
function findTaskModeTag(item: TaskModeFields): string {
  if (item.planFilePath) return '绑定计划'
  if (item.planThenGoal) return '计划→目标'
  if (item.mode === 'plan') return '计划'
  if (item.mode === 'goal') return '目标'
  return ''
}

export {
  DEFAULT_TIMEZONE,
  MODE_OPTIONS,
  OWNER,
  OWNER_HINT,
  OWNER_ORDER,
  RUN_STATUS,
  SESSION_MODE_OPTIONS,
  buildTaskGroups,
  canRunNow,
  compareTasks,
  createDraft,
  filterRuns,
  findDraftProblem,
  findOwnerHint,
  findPhaseLabel,
  findRecentRuns,
  findTaskModeLabel,
  findTaskModeTag,
  findRunDuration,
  findSessionModeLabel,
  findTaskBadge,
  findThinkingLabel,
  formatDuration,
  isCloudTask,
  parseGoalBudget,
  parseMode,
  parseSessionMode,
  summarizeRuns,
  toDraft,
  toSaveInput
}
export type { RecentRun, RunFilter, TaskBadge, TaskBadgeTone, TaskDraft, TaskGroup }
