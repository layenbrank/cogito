/**
 * 定时任务域状态：列表 / 显式执行 / 执行记录。
 *
 * 不做「按 tick 轮询」：到期由 Rust worker claim 后推送 `automation:due`，
 * 执行与回写都在 `features/automation/runner.ts` 里完成；这里只管用户操作。
 */
import { toast } from 'sonner'
import { create } from 'zustand'

import {
  listAutomationRuns,
  listAutomations,
  removeAutomation,
  runAutomationNow,
  saveAutomation,
  setAutomationEnabled,
  type Automation,
  type AutomationRun,
  type AutomationSave
} from '@/lib/automation-ipc'
import { reportCaught } from '@/utils/exception-report'
import { runDue } from '@/features/automation/runner'
import { DELETE_JOB, GET_JOBS, PATCH_JOB, SAVE_JOB } from '@/apis/schedule'
import { toCloudAutomation, toCloudInput } from '@/features/automation/cloud'
import { syncActiveTenant } from '@/features/quota/tenant'
import { findAuthToken } from '@/utils/auth'
import { findActiveTenantID } from '@/utils/tenant.ts'

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
  isLoading: boolean
  /** 正在执行的任务 id 集合：按钮据此显示「执行中」 */
  running: Record<string, boolean>
  refresh: () => Promise<void>
  /** 单独拉服务端任务（登录/切租户后调用） */
  refreshCloud: () => Promise<void>
  save: (input: AutomationSave) => Promise<boolean>
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
  openRuns: (id: string) => Promise<void>
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

const useAutomationStore = create<AutomationState>(function (set, get) {
  return {
    items: [],
    cloudItems: [],
    cloudStatus: 'off',
    cloudError: null,
    activeId: null,
    runs: [],
    isLoading: false,
    running: {},

    async refresh() {
      set({ isLoading: true })
      try {
        set({ items: await listAutomations() })
      } catch (error) {
        reportCaught('automation.refresh', error)
        toast.error(messageOf(error))
      } finally {
        set({ isLoading: false })
      }
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
      if (input.owner === 'cloud') {
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
        await get().refresh()
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
        const updated = await setAutomationEnabled(id, enabled)
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
        toast.info('服务端任务按排期执行，不能手动触发')
        return
      }
      if (get().running[id]) return
      set({ running: { ...get().running, [id]: true } })
      try {
        const due = await runAutomationNow(id)
        if (!due) {
          // owner=goose：执行在 goose 侧，本地没有执行记录
          toast.success('已交给 goose 执行，记录请看 goose 会话')
          return
        }
        // 手动执行与定时执行走同一条执行路径：跑完由 runner 回写结果
        await runDue({
          runId: due.run.id,
          automationId: due.automation.id,
          name: due.automation.name,
          prompt: due.automation.prompt,
          knowledgeBaseId: due.automation.knowledgeBaseId ?? null,
          triggerKind: due.run.triggerKind
        })
        toast.success('执行已结束，结果见下方记录')
      } catch (error) {
        reportCaught('automation.runNow', error)
        toast.error(messageOf(error))
      } finally {
        const next = { ...get().running }
        delete next[id]
        set({ running: next })
        await get().refresh()
        if (get().activeId === id) await get().openRuns(id)
      }
    },

    async openRuns(id) {
      try {
        set({ activeId: id, runs: await listAutomationRuns(id, 10) })
      } catch (error) {
        reportCaught('automation.runs', error)
        toast.error(messageOf(error))
      }
    },

    closeRuns() {
      set({ activeId: null, runs: [] })
    }
  }
})

export { useAutomationStore }
export type { Automation, AutomationRun, AutomationSave }
