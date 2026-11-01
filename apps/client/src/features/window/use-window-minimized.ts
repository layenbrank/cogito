/**
 * 跟踪当前窗口是否处于最小化。
 *
 * Windows 最小化会把客户区收成极小尺寸（历史 Win32 行为），ResizeObserver /
 * 分栏库仍会收到「变窄」——用本 hook 在前端冻结布局逻辑。
 * 嵌套壳 / 无 Tauri 时恒为 false，可再配合宽度阈值兜底。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

import { hasTauriRuntime, isEmbeddedShell } from '@/features/window/shell-mode'

function useWindowMinimized(): boolean {
  const [isMinimized, updateMinimized] = useState(false)

  useEffect(
    function () {
      if (!hasTauriRuntime() || isEmbeddedShell()) return

      const win = getCurrentWindow()
      let isActive = true
      const unlistens: Array<() => void> = []

      function sync() {
        void win
          .isMinimized()
          .then(function (next) {
            if (!isActive) return
            updateMinimized(function (prev) {
              return prev === next ? prev : next
            })
          })
          .catch(function (error: unknown) {
            console.warn('[window] 读最小化状态失败', error)
          })
      }

      sync()
      void win.onResized(sync).then(function (unlisten) {
        if (isActive) unlistens.push(unlisten)
        else unlisten()
      })
      void win.onFocusChanged(sync).then(function (unlisten) {
        if (isActive) unlistens.push(unlisten)
        else unlisten()
      })

      return function () {
        isActive = false
        for (const unlisten of unlistens) unlisten()
      }
    },
    []
  )

  return isMinimized
}

export { useWindowMinimized }
