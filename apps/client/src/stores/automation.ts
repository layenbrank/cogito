/**
 * 任务域状态（列表 / 触发 / 记录）：UI 是右栏「任务」面板（`views/agent/chat/components/aside-tasks.tsx`）。
 *
 * 到期由 Rust worker claim 后推送 `automation:due`；执行与回写在 `features/automation/runner.ts`。
 * 这里管用户操作 + 把 runner 生命周期 / DB lastStatus 合成「执行中」可见态。
 */
import { toast } from 'sonner'
import { create } from 'zustand'

import {
  GET_AUTOMATION_RUNS,
  GET_AUTOMATIONS,
  DELETE_AUTOMATION,
  POST_AUTOMATION_RUN,
  POST_AUTOMATION,
  PUT_AUTOMATION_ENABLED,
  type Automation,
  type AutomationRun,
  type AutomationSave
} from '@/apis/automation'
import { reportCaught } from '@/utils/exception-report'
import { runDue } from '@/features/automation/runner'
import { subscribeAutomationLife } from '@/features/automation/events'
import { DELETE_JOB, GET_JOBS, PATCH_JOB, SAVE_JOB } from '@/apis/schedule'
import { toCloudAutomation, toCloudInput } from '@/features/automation/cloud'
import { syncActiveTenant } from '@/features/quota/tenant'
import { DICT_KEY, DICT_VALUE_BY_KEY } from '@/shared/ipc/specs/dict'
import { findAuthToken } from '@/utils/auth'
import { findActiveTenantID } from '@/utils/tenant.ts'

const OWNER = {
  CLIENT: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLIENT],
  GOOSE: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_GOOSE],
  CLOUD: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLOUD]
}

const RUN_RUNNING = DICT_VALUE_BY_KEY[DICT_KEY.RUN_RUNNING]

/** 有任务在跑时轻量轮询，弥补面板不订阅 ACP 流 */
const POLL_MS = 2500

interface AutomationState {
  items: Automation[]
  /** 服务端任务：只读镜像 + 启停/删除，排期与执行都在服务端 */
  cloudItems: Automation[]
  /** off = 未登录或没有激活租户；error = 拉取失败（卡片里提示，不静默） */
  cloudStatus: 'ok' | 'off' | 'error'
  cloudError: string | null
  /** 当前展开执行记录的任务 id */
  activeId: string | null
  runs: AutomationRun[]
  /** 页面级「全部记录」：跨任务聚合（不指定任务 id 的查询） */
  allRuns: AutomationRun[]
  /** 当前看的是不是「全部记录」（任务详情的记录面板为 false） */
  isAllRunsOpen: boolean
  isLoading: boolean
  /** 正在执行的任务 id 集合：按钮据此显示「执行中」 */
  running: Record<string, boolean>
  /** 进行中 run 的阶段（automationId → phase 文案键） */
  phases: Record<string, string>
  /** 自动化会话 → 任务定义：侧栏「查看任务」回链用 */
  sessionTasks: Record<string, string>
  refresh: () => Promise<void>
  /** 只刷本机 / goose 任务：执行一次不会改变服务端列表，没必要再发一次 HTTP */
  refreshLocal: () => Promise<void>
  /** 单独拉服务端任务（登录/切租户后调用） */
  refreshCloud: () => Promise<void>
  save: (input: AutomationSave) => Promise<boolean>
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
  openRuns: (id: string) => Promise<void>
  openAllRuns: () => Promise<void>
  /** 只回填会话→任务映射，不打开「全部记录」视图 */
  hydrateSessionTasks: () => Promise<void>
  closeRuns: () => void
  /** 是否有本机任务处于执行中（内存 ∪ DB lastStatus） */
  hasRunning: () => boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 判断某个 id 是否属于服务端任务（列表里两种来源共用一套动作入口） */
function isSameID(id: string) {
  return function (item: Automation) {
    return item.id === id
  }
}

/** 记录请求序号：快速切任务时只认最后一次响应，避免迟到的结果覆盖当前列表 */
let runsSeq = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let lifeBound = false

function findHasRunning(state: Pick<AutomationState, 'items' | 'running'>): boolean {
  if (Object.keys(state.running).length > 0) return true
  return state.items.some(function (item) {
    return item.lastStatus === RUN_RUNNING
  })
}

function ensurePoll(get: () => AutomationState) {
  if (pollTimer) return
  if (!findHasRunning(get())) return
  pollTimer = setInterval(function () {
    const state = get()
    if (!findHasRunning(state)) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }
    void state.refreshLocal()
    if (state.isAllRunsOpen) void state.openAllRuns()
    else if (state.activeId) void state.openRuns(state.activeId)
  }, POLL_MS)
}

function stopPollIfIdle(get: () => AutomationState) {
  if (findHasRunning(get())) return
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 从执行记录回填会话→任务映射（刷新后仍能从侧栏回链） */
function mergeSessionTasks(
  current: Record<string, string>,
  runs: AutomationRun[]
): Record<string, string> {
  const next = { ...current }
  for (const run of runs) {
    if (run.sessionId) next[run.sessionId] = run.automationId
  }
  return next
}

const useAutomationStore = create<AutomationState>(function (set, get) {
  if (!lifeBound && typeof window !== 'undefined') {
    lifeBound = true
    subscribeAutomationLife(function (event) {
      if (event.kind === 'start' || event.kind === 'phase' || event.kind === 'stream') {
        set({
          running: { ...get().running, [event.automationId]: true },
          phases: { ...get().phases, [event.automationId]: event.phase },
          sessionTasks: { ...get().sessionTasks, [event.sessionId]: event.automationId }
        })
        ensurePoll(get)
        return
      }
      if (event.kind === 'finish') {
        const running = { ...get().running }
        delete running[event.automationId]
        const phases = { ...get().phases }
        delete phases[event.automationId]
        set({
          running,
          phases,
          sessionTasks: { ...get().sessionTasks, [event.sessionId]: event.automationId }
        })
        void get().refreshLocal()
        if (get().isAllRunsOpen) void get().openAllRuns()
        else if (get().activeId === event.automationId) void get().openRuns(event.automationId)
        stopPollIfIdle(get)
        if (!event.ok && event.error) {
          toast.error(event.error)
        }
      }
    })
  }

  return {
    items: [],
    cloudItems: [],
    cloudStatus: 'off',
    cloudError: null,
    activeId: null,
    runs: [],
    allRuns: [],
    isAllRunsOpen: false,
    isLoading: false,
    running: {},
    phases: {},
    sessionTasks: {},

    hasRunning() {
      return findHasRunning(get())
    },

    async refreshLocal() {
      set({ isLoading: true })
      try {
        const items = await GET_AUTOMATIONS()
        const memory = { ...get().running }
        const phases = get().phases
        // 内存 running 只由 runNow / 生命周期事件写入。
        // 禁止用 DB lastStatus=RUNNING 回填：跑挂 / 未 finish 时库里会长期停在 RUNNING，
        // 一刷新就把按钮永久锁死。库状态只用来驱动轮询（findHasRunning）。
        const byID = new Map(
          items.map(function (row) {
            return [row.id, row]
          })
        )
        for (const id of Object.keys(memory)) {
          const item = byID.get(id)
          if (!item) {
            delete memory[id]
            continue
          }
          if (item.lastStatus && item.lastStatus !== RUN_RUNNING && !phases[id]) {
            delete memory[id]
          }
        }
        set({ items, running: memory })
        ensurePoll(get)
        stopPollIfIdle(get)
      } catch (error) {
        reportCaught('automation.refresh', error)
        toast.error(messageOf(error))
      } finally {
        set({ isLoading: false })
      }
    },

    async refresh() {
      await get().refreshLocal()
      await get().refreshCloud()
    },

    async refreshCloud() {
      if (!findAuthToken()) {
        set({ cloudItems: [], cloudStatus: 'off', cloudError: null })
        return
      }
      const tenant = findActiveTenantID() ?? (await syncActiveTenant())
      if (!tenant) {
        set({ cloudItems: [], cloudStatus: 'off', cloudError: null })
        return
      }
      try {
        const jobs = await GET_JOBS()
        set({
          cloudItems: jobs.map(toCloudAutomation),
          cloudStatus: 'ok',
          cloudError: null
        })
      } catch (error) {
        reportCaught('automation.refreshCloud', error, 'warning')
        set({ cloudStatus: 'error', cloudError: messageOf(error) })
      }
    },

    async save(input) {
      if (input.owner === OWNER.CLOUD) {
        try {
          await SAVE_JOB(toCloudInput(input))
          await get().refreshCloud()
          toast.success(input.id ? '服务端任务已更新' : '服务端任务已创建')
          return true
        } catch (error) {
          toast.error(messageOf(error))
          return false
        }
      }
      try {
        await POST_AUTOMATION(input)
        await get().refreshLocal()
        toast.success(input.id ? '任务已更新' : '任务已创建')
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },

    async toggle(id, enabled) {
      if (get().cloudItems.some(isSameID(id))) {
        try {
          await PATCH_JOB(id, { enabled })
          await get().refreshCloud()
        } catch (error) {
          toast.error(messageOf(error))
        }
        return
      }
      try {
        const updated = await PUT_AUTOMATION_ENABLED(id, enabled)
        set({
          items: get().items.map(function (item) {
            return item.id === updated.id ? updated : item
          })
        })
      } catch (error) {
        reportCaught('automation.toggle', error)
        toast.error(messageOf(error))
      }
    },

    async remove(id) {
      if (get().cloudItems.some(isSameID(id))) {
        try {
          await DELETE_JOB(id)
          await get().refreshCloud()
        } catch (error) {
          toast.error(messageOf(error))
        }
        return
      }
      try {
        await DELETE_AUTOMATION(id)
        set({
          items: get().items.filter(function (item) {
            return item.id !== id
          }),
          activeId: get().activeId === id ? null : get().activeId,
          // 执行记录也跟着走：任务没了还挂在「全部记录」里，点进去是一条无主的记录
          runs: get().runs.filter(function (run) {
            return run.automationId !== id
          }),
          allRuns: get().allRuns.filter(function (run) {
            return run.automationId !== id
          })
        })
      } catch (error) {
        reportCaught('automation.remove', error)
        toast.error(messageOf(error))
      }
    },

    async runNow(id) {
      if (get().cloudItems.some(isSameID(id))) {
        toast.info('服务端任务按排期执行，暂不支持手动触发（接口还没上）')
        return
      }
      if (get().running[id]) return
      set({ running: { ...get().running, [id]: true } })
      ensurePoll(get)
      function clearRunning() {
        const next = { ...get().running }
        delete next[id]
        const phases = { ...get().phases }
        delete phases[id]
        set({ running: next, phases })
        stopPollIfIdle(get)
      }
      try {
        const due = await POST_AUTOMATION_RUN(id)
        if (!due) {
          toast.success('已交给 goose 执行，记录请看 goose 会话')
          clearRunning()
          return
        }
        void runDue({
          runId: due.run.id,
          automationId: due.automation.id,
          name: due.automation.name,
          prompt: due.automation.prompt,
          knowledgeSpaceId: due.automation.knowledgeSpaceId ?? null,
          workspaceId: due.automation.workspaceId ?? null,
          workspacePath: due.automation.workspacePath ?? null,
          sessionMode: due.automation.sessionMode ?? 'new',
          sessionId: due.automation.sessionId ?? null,
          approval: due.automation.approval,
          providerId: due.automation.providerId ?? null,
          modelId: due.automation.modelId ?? null,
          mode: due.automation.mode ?? 'agent',
          goalBudget: due.automation.goalBudget ?? 6,
          planThenGoal: due.automation.planThenGoal === true,
          planFilePath: due.automation.planFilePath ?? null,
          // 与定时触发同一条口径：思考强度取自任务行，缺省「标准」
          thinking: due.automation.thinking ?? 'medium',
          triggerKind: due.run.triggerKind
        }).finally(function () {
          // runner 收尾必清内存锁；finish 事件也会清。不再等 DB lastStatus，
          // 避免 finish 写库失败 / 陈旧 RUNNING 把「立即执行」永久禁用。
          clearRunning()
          void get().refreshLocal()
          if (get().isAllRunsOpen) void get().openAllRuns()
          else if (get().activeId === id) void get().openRuns(id)
        })
        await get().refreshLocal()
        if (get().isAllRunsOpen) await get().openAllRuns()
        else if (get().activeId === id) await get().openRuns(id)
      } catch (error) {
        reportCaught('automation.runNow', error)
        toast.error(messageOf(error))
        clearRunning()
      }
    },

    async openRuns(id) {
      const seq = ++runsSeq
      /*
       * 先把归属切过去并**清空**：不然切任务的那几帧里，新任务的标题下面
       * 挂的还是上一个任务的执行记录（点「再跑一次 / 打开会话」会指向 A 的 run）。
       */
      set({ activeId: id, isAllRunsOpen: false, runs: [] })
      try {
        const runs = await GET_AUTOMATION_RUNS(id, 20)
        if (seq !== runsSeq) return
        set({
          activeId: id,
          isAllRunsOpen: false,
          runs,
          sessionTasks: mergeSessionTasks(get().sessionTasks, runs)
        })
      } catch (error) {
        reportCaught('automation.runs', error)
        toast.error(messageOf(error))
      }
    },

    async openAllRuns() {
      const seq = ++runsSeq
      try {
        const allRuns = await GET_AUTOMATION_RUNS(null, 50)
        if (seq !== runsSeq) return
        set({
          isAllRunsOpen: true,
          allRuns,
          sessionTasks: mergeSessionTasks(get().sessionTasks, allRuns)
        })
      } catch (error) {
        reportCaught('automation.allRuns', error)
        toast.error(messageOf(error))
      }
    },

    async hydrateSessionTasks() {
      try {
        const runs = await GET_AUTOMATION_RUNS(null, 50)
        set({ sessionTasks: mergeSessionTasks(get().sessionTasks, runs) })
      } catch (error) {
        reportCaught('automation.sessionTasks', error, 'warning')
      }
    },

    closeRuns() {
      runsSeq += 1
      set({ activeId: null, runs: [], isAllRunsOpen: false })
    }
  }
})

export { useAutomationStore }
export type { Automation, AutomationRun, AutomationSave }
