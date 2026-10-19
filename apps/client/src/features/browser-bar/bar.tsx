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
  children: ReactNode
}

function BrowserBar({
  onBind,
  leading,
  trailing,
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
        'z-20 flex shrink-0 items-stretch border-b border-border bg-background select-none',
        !state.isFocused && 'opacity-80'
      )}
      style={{ height: BROWSER_BAR, minHeight: BROWSER_BAR }}>
      <div className="flex min-w-0 flex-1 items-center">
        {leading}
        {children}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-0.5 pr-1">{trailing}</div> : null}
      <WindowControls
        state={state}
        onRefresh={refresh}
      />
    </header>
  )
}

export { BrowserBar }
