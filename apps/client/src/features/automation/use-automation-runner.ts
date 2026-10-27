/**
 * 在应用根挂上定时任务的监听（`automation:due` → 起会话执行 → 回写）。
 *
 * 只挂一次：`App` 顶层调用，卸载时取消监听。放在这里而不是某个页面里，
 * 是因为任务到期时用户可能根本不在知识库页面。
 */
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useEffect } from 'react'

import { installAutomationRunner } from '@/features/automation/runner'
import { reportCaught } from '@/utils/exception-report'

function useAutomationRunner(): void {
  useEffect(function () {
    let unlisten: UnlistenFn | null = null
    let disposed = false

    void installAutomationRunner()
      .then(function (off) {
        // 严格模式下 effect 会立刻卸载：晚到的监听要马上取消，否则会挂两份
        if (disposed) off()
        else unlisten = off
      })
      .catch(function (error) {
        reportCaught('agent.automation.listen', error, 'warning')
      })

    return function () {
      disposed = true
      unlisten?.()
    }
  }, [])
}

export { useAutomationRunner }
