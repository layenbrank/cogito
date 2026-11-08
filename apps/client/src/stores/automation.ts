/**
 * 任务域状态（列表 / 触发 / 记录）：UI 是右栏「任务」面板（`views/agent/chat/components/aside-tasks.tsx`），不再占独立页面。
 *
 * 不做「按 tick 轮询」：到期由 Rust worker claim 后推送 `automation:due`，
 * 执行与回写都在 `features/automation/runner.ts` 里完成；这里只管用户操作
 * （加载三源列表、启停、立即执行、拉记录），口径说明见 `docs/apps/client/agent-tasks.md`。
 */
import { toast } from 'sonner'
import { create } from 'zustand'

import {
  listAutomationRuns,
  listAutomations,
  removeAutomation,
  runAutomationNow,
  saveAutomation,
  writeAutomationEnabled,
  type Automation,
  type AutomationRun,
  type AutomationSave
} from '@/lib/automation-ipc'
import { reportCaught } from '@/utils/exception-report'
import { runDue } from '@/features/automation/runner'
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
  closeRuns: () => void
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

const useAutomationStore = create<AutomationState>(function (set, get) {
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

    async refreshLocal() {
      set({ isLoading: true })
      try {
        set({ items: await listAutomations() })
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
      // 租户可能还没解析过（首次打开任务页）：先解析再说；解析不出来就当不可用，不猜租户
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
        // 断网/无权限都不该让本机任务列表崩掉：只把原因记在卡片里
        reportCaught('automation.refreshCloud', error, 'warning')
        set({ cloudStatus: 'error', cloudError: messageOf(error) })
      }
    },

    async save(input) {
      // 服务端任务走 HTTP：本地不落行，排期与执行都在服务端
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
        await saveAutomation(input)
        await get().refreshLocal()
        toast.success(input.id ? '任务已更新' : '任务已创建')
        return true
      } catch (error) {
        // cron / 时区写错在保存时就报，直接给用户看原文
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
        const updated = await writeAutomationEnabled(id, enabled)
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
        await removeAutomation(id)
        set({
          items: get().items.filter(function (item) {
            return item.id !== id
          }),
          activeId: get().activeId === id ? null : get().activeId
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
      function clearRunning() {
        const next = { ...get().running }
        delete next[id]
        set({ running: next })
      }
      try {
        const due = await runAutomationNow(id)
        if (!due) {
          // owner=goose：执行在 goose 侧，本地没有执行记录
          toast.success('已交给 goose 执行，记录请看 goose 会话')
          clearRunning()
          return
        }
        // 手动执行与定时执行走同一条执行路径（runner 回写结果）。
        // **不等它跑完**：模型一轮可能几分钟，界面靠 running[id] 与记录里的 running 状态显示进度。
        void runDue({
          runId: due.run.id,
          automationId: due.automation.id,
          name: due.automation.name,
          prompt: due.automation.prompt,
          knowledgeBaseId: due.automation.knowledgeBaseId ?? null,
          workspaceId: due.automation.workspaceId ?? null,
          approval: due.automation.approval,
          triggerKind: due.run.triggerKind
        }).finally(function () {
          clearRunning()
          void get().refreshLocal()
          if (get().isAllRunsOpen) void get().openAllRuns()
          else if (get().activeId === id) void get().openRuns(id)
        })
        // 记录已经落库（running），先把列表刷出「执行中」再放手
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
      try {
        const runs = await listAutomationRuns(id, 20)
        // A→B 快速切换时，A 的迟到响应不许覆盖 B
        if (seq !== runsSeq) return
        set({ activeId: id, isAllRunsOpen: false, runs })
      } catch (error) {
        reportCaught('automation.runs', error)
        toast.error(messageOf(error))
      }
    },

    async openAllRuns() {
      // 跨任务：一次 IPC 拿最近 50 条，页面里再按状态筛（不做 N 次查询）
      const seq = ++runsSeq
      try {
        const allRuns = await listAutomationRuns(null, 50)
        if (seq !== runsSeq) return
        set({ isAllRunsOpen: true, allRuns })
      } catch (error) {
        reportCaught('automation.allRuns', error)
        toast.error(messageOf(error))
      }
    },

    closeRuns() {
      // 让还在路上的记录请求失效，别在关掉面板后又把结果写回来
      runsSeq += 1
      set({ activeId: null, runs: [], isAllRunsOpen: false })
    }
  }
})

export { useAutomationStore }
export type { Automation, AutomationRun, AutomationSave }
