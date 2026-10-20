import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from 'cn'
import type { MouseEvent, ReactNode } from 'react'

import { useCaptionState } from '@/components/caption/caption'
import { WindowControls } from '@/features/browser-bar/controls'
import { BROWSER_BAR } from '@/features/browser-bar/metrics'

interface BrowserBarProps {
  onBind: (node: HTMLDivElement | null) => void
  leading?: ReactNode
  trailing?: ReactNode
  /** 承载网页的窗口传 `left`：窗口键的 tooltip 不能往内容槽里掉。 */
  controlsTooltipSide?: 'bottom' | 'left'
  children: ReactNode
}

function BrowserBar({
  onBind,
  leading,
  trailing,
  controlsTooltipSide,
  children
}: BrowserBarProps) {
  const { state, refresh } = useCaptionState()

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
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
    <header
      ref={onBind}
      data-region="true"
      data-focused={state.isFocused ? 'true' : 'false'}
      onDoubleClick={onDoubleClick}
      className={cn(
        // 左右 1fr 等宽 → 搜索几何居中；中间 minmax(0,…) 可收缩，避免宽 omnibar 叠到 trailing
        'z-20 grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] items-center border-b border-border bg-background select-none',
        !state.isFocused && 'opacity-80'
      )}
      style={{ height: BROWSER_BAR, minHeight: BROWSER_BAR }}>
      <div className="flex min-w-0 items-center justify-start gap-0.5 pl-1">
        {leading}
      </div>
      <div
        className="flex w-full min-w-0 items-center justify-center px-2"
        data-region="false">
        {children}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-0.5 pr-1">
        {trailing}
        <WindowControls
          state={state}
          tooltipSide={controlsTooltipSide}
          onRefresh={refresh}
        />
      </div>
    </header>
  )
}

export { BrowserBar }
