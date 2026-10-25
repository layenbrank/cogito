import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from 'cn'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { WindowControls } from '@/features/browser-bar/controls'
import { BROWSER_BAR } from '@/features/browser-bar/metrics'
import { findAppComponent, isMainWindow } from '@/features/magnetic-tile/session'
import { TileSessionBar } from '@/features/magnetic-tile/session-bar'

/**
 * 通用标题栏（窗口装饰）。
 *
 * 对齐主流桌面壳（Win11 Caption / Fluent TitleBar / Electron·VS Code 自绘栏）：
 * - 操作：最小化 / 最大化⇄还原（全屏时退出全屏）/ 关闭；可选置顶（`controls.pin`）
 * - 尺寸与窗口键样式跟主页地址栏一致（高 56、圆角键）
 * - 状态：focused · maximized · fullscreen · alwaysOnTop · minimizable · maximizable · closable
 * - 失焦降对比；无能力时禁用对应键；双击拖拽区切换最大化（全屏则退出全屏）
 *
 * 所有窗口都 `decorations: false`，桌面壳由本组件自绘：左侧 `begin` 槽、
 * 右侧 `final` 槽 + 窗口键。拖拽区用 `data-region="true"`
 *（CSS `-webkit-app-region: drag`）；交互元素必须
 * `data-region="false"`，否则拖拽区会吃掉点击。
 *
 * Win11 Snap Layouts 需原生 HTMAXBUTTON 命中（WebView2 挡在前面），要另接
 * snap-layout 类插件；maximize 键挂 `data-window-control="maximize"` 供后续附着。
 */

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
    // 可选键：主窗口 / 磁贴窗默认不显示，需 `controls={{ pin: true }}`
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
      // 还原用双框；最大化用单框（Fluent / VS Code 惯例）
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

  useEffect(function () {
    const win = getCurrentWindow()
    let isActive = true
    const unlistens: Array<() => void> = []

    function sync() {
      void findCaptionState(win)
        .then(function (next) {
          if (isActive) updateState(next)
        })
        .catch(function (error: unknown) {
          console.warn('[caption] 读不到窗口装饰状态', error)
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
  }, [])

  function refresh() {
    void findCaptionState(getCurrentWindow())
      .then(updateState)
      .catch(function (error: unknown) {
        console.warn('[caption] 刷新窗口装饰状态失败', error)
      })
  }

  return { state, refresh }
}

interface CaptionProps {
  className?: string
  /** 左侧主区域：标题、筛选、视图切换等 */
  begin?: ReactNode
  /** 右侧扩展区域，渲染在窗口控制键左侧；与 `begin` 对立 */
  final?: ReactNode
  /**
   * 窗口键开关：`true` 全开默认键（最小化/最大化/关闭），
   * 对象形式可单独关掉或打开可选键（如 `pin: true`）
   */
  controls?: boolean | Partial<Record<WindowControlKey, boolean>>
}

function findVisibleControls(
  controls: CaptionProps['controls']
): readonly WindowControl[] {
  if (controls === false) return []
  const flags = typeof controls === 'object' ? controls : null
  return WINDOW_CONTROLS.filter(function (control) {
    const flag = flags?.[control.key]
    if (flag === false) return false
    if (flag === true) return true
    return control.isDefault !== false
  })
}

function Caption(props: CaptionProps) {
  const { state, refresh } = useCaptionState()
  const location = useLocation()
  const controls = findVisibleControls(props.controls)
  const showsSessions = isMainWindow() && findAppComponent(location.pathname) !== null

  function onCaptionDoubleClick(event: MouseEvent<HTMLDivElement>) {
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

  return (
    <div
      data-region="true"
      data-focused={state.isFocused ? 'true' : 'false'}
      data-maximized={state.isMaximized ? 'true' : 'false'}
      data-fullscreen={state.isFullscreen ? 'true' : 'false'}
      onDoubleClick={onCaptionDoubleClick}
      className={cn(
        'relative z-20 flex w-full shrink-0 items-stretch border-b border-border bg-background select-none',
        !state.isFocused && 'opacity-80',
        props.className
      )}
      style={{ height: BROWSER_BAR, minHeight: BROWSER_BAR }}>
      <div
        data-region="true"
        className="flex min-w-0 flex-1 items-center gap-1 pl-1.5">
        {showsSessions ? <TileSessionBar /> : null}
        {props.begin}
      </div>
      <div
        data-region="false"
        className="flex h-full shrink-0 items-center justify-end gap-1 pr-1.5">
        {props.final ? (
          <div className="flex h-9 items-center gap-1">{props.final}</div>
        ) : null}
        <WindowControls
          controls={controls}
          state={state}
          onRefresh={refresh}
        />
      </div>
    </div>
  )
}

export { Caption, WINDOW_CONTROLS, useCaptionState }
export type { CaptionProps, WindowControl, WindowControlKey, CaptionState }
