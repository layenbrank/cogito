import { cn } from 'cn'
import type { MouseEvent, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { WindowControls } from '@/features/window-shell/controls'
import { SHELL_BAR } from '@/features/window-shell/metrics'
import {
  WINDOW_CONTROLS,
  runCaptionDoubleClick,
  useCaptionState,
  type WindowControl,
  type WindowControlKey
} from '@/features/window-shell/state'
import { findAppComponent, isMainWindow } from '@/features/magnetic-tile/session'
import { TileSessionBar } from '@/features/magnetic-tile/session-bar'

/**
 * 通用操作栏（窗口装饰）。
 *
 * - 无 `center`：左侧 `begin`（可含会话条）+ 右侧 `final` + 窗控
 * - 有 `center`：三列 grid，中列居中；`centerLayout` 决定中列几何
 *   - `omnibar`（默认）：中列上限 36rem（Overview Omnibar）
 *   - `thirds`：三等分，左右列恒等宽 → 中列中心恒等于窗口中心（应用窗搜索）
 */

/** 中列几何：`omnibar` 沿用 Overview 宽度；`thirds` 让中列中心落在窗口中线 */
const CENTER_COLUMNS = {
  omnibar: 'grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)]',
  thirds: 'grid-cols-3'
} as const

interface CaptionProps {
  className?: string
  /** 左侧主区域：标题、筛选、视图切换等 */
  begin?: ReactNode
  /** 中间区域（Overview Omnibar / 应用窗搜索）；有值时改用三列布局 */
  center?: ReactNode
  /**
   * 中列几何：`omnibar` 沿用 Overview 的 36rem 上限；`thirds` 三等分，
   * 左右两列恒等宽，中列真正落在窗口中线（不受两侧控件宽度影响）。
   */
  centerLayout?: keyof typeof CENTER_COLUMNS
  /** 右侧扩展区域，渲染在窗口控制键左侧 */
  final?: ReactNode
  /**
   * 窗口键开关：`true` 全开默认键（最小化/最大化/关闭），
   * 对象形式可单独关掉或打开可选键（如 `pin: true`）
   */
  controls?: boolean | Partial<Record<WindowControlKey, boolean>>
  /** 提示气泡方向；承载网页时用 `left` */
  controlsTooltipSide?: 'bottom' | 'left'
  /** 强制显示/隐藏会话条；默认：主窗应用路由自动显示 */
  showsSessions?: boolean
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
  const { state, refresh, canUseWindowApi } = useCaptionState()
  const location = useLocation()
  const controls = findVisibleControls(canUseWindowApi ? props.controls : false)
  const hasCenter = Boolean(props.center)
  const showsSessions =
    props.showsSessions ??
    (isMainWindow() && findAppComponent(location.pathname) !== null)

  function onCaptionDoubleClick(event: MouseEvent<HTMLDivElement>) {
    runCaptionDoubleClick(event, state, canUseWindowApi, refresh)
  }

  if (hasCenter) {
    return (
      <header
        data-region="true"
        data-focused={state.isFocused ? 'true' : 'false'}
        data-maximized={state.isMaximized ? 'true' : 'false'}
        data-fullscreen={state.isFullscreen ? 'true' : 'false'}
        onDoubleClick={onCaptionDoubleClick}
        className={cn(
          'z-20 grid shrink-0 items-center border-b border-border bg-background select-none',
          CENTER_COLUMNS[props.centerLayout ?? 'omnibar'],
          !state.isFocused && 'opacity-80',
          props.className
        )}
        style={{ height: SHELL_BAR, minHeight: SHELL_BAR }}>
        <div className="flex h-full min-w-0 items-center justify-start gap-1 pl-1.5">
          {showsSessions ? <TileSessionBar /> : null}
          {props.begin}
        </div>
        <div
          className="flex h-full w-full min-w-0 items-center justify-center px-2"
          data-region="false">
          {props.center}
        </div>
        <div
          data-region="false"
          className="flex h-full min-w-0 items-center justify-end gap-1 pr-1.5">
          {props.final ? (
            <div className="flex h-9 min-w-0 items-center justify-end gap-1">
              {props.final}
            </div>
          ) : null}
          <WindowControls
            controls={controls}
            state={state}
            tooltipSide={props.controlsTooltipSide}
            onRefresh={refresh}
          />
        </div>
      </header>
    )
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
      style={{ height: SHELL_BAR, minHeight: SHELL_BAR }}>
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
          tooltipSide={props.controlsTooltipSide}
          onRefresh={refresh}
        />
      </div>
    </div>
  )
}

export { Caption }
export type { CaptionProps }
