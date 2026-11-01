import { cn } from 'cn'
import type { CSSProperties, ReactNode } from 'react'

import { markPaneType } from './parse-children'
import type { SplitterPaneProps } from './types'

interface SplitterPaneViewProps {
  id: string
  className?: string
  style?: CSSProperties
  flexBasisPct: number
  isCollapsed: boolean
  destroyOnHidden?: boolean
  isAnimating?: boolean
  children?: ReactNode
}

function SplitterPaneView(props: SplitterPaneViewProps) {
  const {
    id,
    className,
    style,
    flexBasisPct,
    isCollapsed,
    destroyOnHidden,
    isAnimating,
    children
  } = props

  if (destroyOnHidden && isCollapsed) {
    return (
      <div
        id={id}
        data-slot="splitter-pane"
        data-splitter-pane=""
        data-collapsed=""
        className={cn('min-h-0 min-w-0 overflow-hidden', className)}
        style={{
          ...style,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 0,
          overflow: 'hidden'
        }}
      />
    )
  }

  return (
    <div
      id={id}
      data-slot="splitter-pane"
      data-splitter-pane=""
      data-collapsed={isCollapsed || undefined}
      data-splitter-animating={isAnimating || undefined}
      className={cn('min-h-0 min-w-0 overflow-hidden', className)}
      style={{
        ...style,
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: `${flexBasisPct}%`,
        overflow: 'hidden',
        maxWidth: undefined,
        maxHeight: undefined
      }}>
      {children}
    </div>
  )
}

/** 占位组件：仅用于 Splitter children 声明 */
function SplitterPane(_props: SplitterPaneProps) {
  return null
}

markPaneType(SplitterPane)

export { SplitterPane, SplitterPaneView }
