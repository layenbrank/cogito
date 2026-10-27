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

interface AutomationState {
  items: Automation[]
  /** 当前展开执行记录的任务 id */
  activeId: string | null
  runs: AutomationRun[]
  isLoading: boolean
  /** 正在执行的任务 id 集合：按钮据此显示「执行中」 */
  running: Record<string, boolean>
  refresh: () => Promise<void>
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

const useAutomationStore = create<AutomationState>(function (set, get) {
  return {
    items: [],
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
    },

    async save(input) {
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
