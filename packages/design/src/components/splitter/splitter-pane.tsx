import { cn } from 'cn'
import type { CSSProperties, ReactNode } from 'react'

import { markPaneType } from './parse-children'
import type { SplitterPaneProps } from './types'

interface SplitterPaneViewProps {
  id: string
  className?: string
  style?: CSSProperties
  flexBasisPct: number
  /** 分隔条总厚度：各栏百分比按整个容器算，扣掉它才不会顶出右/下边缘 */
  gutterPx: number
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
    gutterPx,
    isCollapsed,
    destroyOnHidden,
    isAnimating,
    children
  } = props

  // 百分比按整个容器算，而分隔条本身也占宽：每栏再扣掉自己那份分隔条厚度
  const basis =
    gutterPx > 0
      ? `calc(${flexBasisPct}% - ${((flexBasisPct / 100) * gutterPx).toFixed(3)}px)`
      : `${flexBasisPct}%`

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
        flexBasis: basis,
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
