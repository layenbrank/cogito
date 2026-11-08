/**
 * 任务页的纯逻辑：三源合并、按执行方分组、排序、状态聚合、记录筛选、表单草稿互转。
 *
 * 全部无副作用、不碰 IPC 与 React —— 单测直接调（`model.test.ts`）。
 * 「谁先谁后」「什么时候算停用」这类口径写在这里一处，列表与详情共用。
 */
import { isValidSchedule } from '@/features/automation/describe-schedule'
import type { Automation, AutomationRun, AutomationSave } from '@/shared/ipc/specs/automation'
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
  approval: 'readonly' | 'auto'
  knowledgeBaseId: string | null
  enabled: boolean
}

const DEFAULT_TIMEZONE = 'Asia/Shanghai'

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
    approval: item.approval === 'auto' ? 'auto' : 'readonly',
    knowledgeBaseId: item.knowledgeBaseId ?? null,
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
    approval: 'readonly',
    knowledgeBaseId: null,
    enabled: true
  }
}

/**
 * 草稿能否保存：空名 / 空指令 / 空表达式不放过；自动批准必须有工作目录
 * （与服务端 `Service::toSave` 同一条规则，前端先拦一次省一个来回）。
 */
function findDraftProblem(draft: TaskDraft): string | null {
  if (!draft.name.trim()) return '任务名称不能为空'
  if (!draft.prompt.trim()) return '任务内容不能为空'
  if (!draft.schedule.trim()) return '定时表达式不能为空'
  if (!isValidSchedule(draft.schedule)) {
    return '时间表达式不合法：用上面的可视化选项重新选一次即可'
  }
  if (draft.approval === 'auto' && !draft.workspaceId) {
    return '自动批准必须先指定工作目录（把写入范围限制在目录内）'
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
    approval: draft.approval,
    knowledgeBaseId: draft.knowledgeBaseId,
    enabled: draft.enabled
  }
}

export {
  DEFAULT_TIMEZONE,
  OWNER,
  OWNER_HINT,
  OWNER_ORDER,
  RUN_STATUS,
  buildTaskGroups,
  canRunNow,
  compareTasks,
  createDraft,
  filterRuns,
  findDraftProblem,
  findOwnerHint,
  findRunDuration,
  findTaskBadge,
  formatDuration,
  isCloudTask,
  summarizeRuns,
  toDraft,
  toSaveInput
}
export type { RunFilter, TaskBadge, TaskBadgeTone, TaskDraft, TaskGroup }
