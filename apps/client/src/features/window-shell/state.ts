import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState, type MouseEvent } from 'react'

import { hasTauriRuntime, isEmbeddedShell } from '@/features/window/shell-mode'

type AppWindow = ReturnType<typeof getCurrentWindow>

type WindowControlKey = 'minimize' | 'maximize' | 'close' | 'pin'

interface CaptionState {
  isFocused: boolean
  isMaximized: boolean
  isFullscreen: boolean
  isAlwaysOnTop: boolean
  isMinimizable: boolean
  isMaximizable: boolean
  isClosable: boolean
}

interface WindowControl {
  key: WindowControlKey
  /** 默认是否渲染；`pin` 默认关，需 `controls.pin === true` */
  isDefault?: boolean
  findLabel: (state: CaptionState) => string
  findIcon: (state: CaptionState) => string
  /** 危险动作：hover 用 destructive 配色（关闭） */
  isDestructive?: boolean
  isEnabled: (state: CaptionState) => boolean
  /** 动作后是否需要立刻重读状态（无对应窗口事件时） */
  needsRefresh?: boolean
  run: (win: AppWindow, state: CaptionState) => Promise<void>
}

const CAPTION_STATE: CaptionState = {
  isFocused: true,
  isMaximized: false,
  isFullscreen: false,
  isAlwaysOnTop: false,
  isMinimizable: true,
  isMaximizable: true,
  isClosable: true
}

/** 窗口键表：顺序即渲染顺序（右上角从左到右，对齐 Windows Caption） */
const WINDOW_CONTROLS: readonly WindowControl[] = [
  {
    key: 'pin',
    isDefault: false,
    needsRefresh: true,
    findLabel: function (state) {
      return state.isAlwaysOnTop ? '取消置顶' : '置顶'
    },
    findIcon: function (state) {
      return state.isAlwaysOnTop ? 'lucide:pin-off' : 'lucide:pin'
    },
    isEnabled: function () {
      return true
    },
    async run(win, state) {
      await win.setAlwaysOnTop(!state.isAlwaysOnTop)
    }
  },
  {
    key: 'minimize',
    isDefault: true,
    findLabel: function () {
      return '最小化'
    },
    findIcon: function () {
      return 'lucide:minus'
    },
    isEnabled: function (state) {
      return state.isMinimizable && !state.isFullscreen
    },
    async run(win) {
      await win.minimize()
    }
  },
  {
    key: 'maximize',
    isDefault: true,
    needsRefresh: true,
    findLabel: function (state) {
      if (state.isFullscreen) return '退出全屏'
      return state.isMaximized ? '还原' : '最大化'
    },
    findIcon: function (state) {
      if (state.isFullscreen) return 'lucide:minimize-2'
      return state.isMaximized ? 'lucide:copy' : 'lucide:square'
    },
    isEnabled: function (state) {
      return state.isMaximizable || state.isFullscreen
    },
    async run(win, state) {
      if (state.isFullscreen) {
        await win.setFullscreen(false)
        return
      }
      await win.toggleMaximize()
    }
  },
  {
    key: 'close',
    isDefault: true,
    findLabel: function () {
      return '关闭'
    },
    findIcon: function () {
      return 'lucide:x'
    },
    isDestructive: true,
    isEnabled: function (state) {
      return state.isClosable
    },
    async run(win) {
      await win.close()
    }
  }
]

async function findCaptionState(win: AppWindow): Promise<CaptionState> {
  const [
    isFocused,
    isMaximized,
    isFullscreen,
    isAlwaysOnTop,
    isMinimizable,
    isMaximizable,
    isClosable
  ] = await Promise.all([
    win.isFocused(),
    win.isMaximized(),
    win.isFullscreen(),
    win.isAlwaysOnTop(),
    win.isMinimizable(),
    win.isMaximizable(),
    win.isClosable()
  ])
  return {
    isFocused,
    isMaximized,
    isFullscreen,
    isAlwaysOnTop,
    isMinimizable,
    isMaximizable,
    isClosable
  }
}

/** 订阅窗口装饰相关状态（图标、可用性、失焦对比度） */
function useCaptionState() {
  const [state, updateState] = useState<CaptionState>(CAPTION_STATE)
  const canUseWindowApi = hasTauriRuntime() && !isEmbeddedShell()

  useEffect(
    function () {
      if (!canUseWindowApi) return
      const win = getCurrentWindow()
      let isActive = true
      const unlistens: Array<() => void> = []

      function sync() {
        void findCaptionState(win)
          .then(function (next) {
            if (isActive) updateState(next)
          })
          .catch(function (error: unknown) {
            console.warn('[window-shell] 读不到窗口装饰状态', error)
          })
      }

      sync()

      void win.onResized(sync).then(function (fn) {
        if (isActive) unlistens.push(fn)
        else fn()
      })
      void win.onFocusChanged(sync).then(function (fn) {
        if (isActive) unlistens.push(fn)
        else fn()
      })

      return function () {
        isActive = false
        for (const unlisten of unlistens) unlisten()
      }
    },
    [canUseWindowApi]
  )

  function refresh() {
    if (!canUseWindowApi) return
    void findCaptionState(getCurrentWindow())
      .then(updateState)
      .catch(function (error: unknown) {
        console.warn('[window-shell] 刷新窗口装饰状态失败', error)
      })
  }

  return { state, refresh, canUseWindowApi }
}

function runCaptionDoubleClick(
  event: MouseEvent<HTMLElement>,
  state: CaptionState,
  canUseWindowApi: boolean,
  refresh: () => void
) {
  if (!canUseWindowApi) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-region="false"]')) return
  if (!state.isMaximizable && !state.isFullscreen) return

  const win = getCurrentWindow()
  if (state.isFullscreen) {
    void win.setFullscreen(false).then(refresh)
    return
  }
  void win.toggleMaximize().then(refresh)
}

export {
  CAPTION_STATE,
  WINDOW_CONTROLS,
  findCaptionState,
  runCaptionDoubleClick,
  useCaptionState
}
export type { CaptionState, WindowControl, WindowControlKey }
