import type { CSSProperties, ReactNode, Ref } from 'react'

type SizeValue = number | `${number}%` | string

type CollapseVisible = boolean | 'auto'

type CollapsePosition = 'center' | 'start' | 'end'

interface CollapseSideConfig {
  visible?: CollapseVisible
  position?: CollapsePosition
  className?: string
  icon?: ReactNode
  render?: (ctx: CollapseRenderContext) => ReactNode
}

interface CollapseRenderContext {
  side: 'start' | 'end'
  isCollapsed: boolean
  collapse: () => void
  expand: () => void
}

interface PaneCollapsibleConfig {
  start?: boolean
  end?: boolean
  showIcon?: CollapseVisible
}

interface PaneHandle {
  collapse(): void
  expand(): void
  isCollapsed(): boolean
  resize(size: SizeValue): void
  findSize(): { inPixels: number; inPercentage: number }
}

interface GroupHandle {
  setLayout(layout: Record<string, number>): void
  findLayout(): Record<string, number>
}

interface LayoutChangeMeta {
  isUserInteraction?: boolean
}

interface SplitterProps {
  id?: string
  orientation?: 'horizontal' | 'vertical'
  className?: string
  style?: CSSProperties
  children?: ReactNode
  groupRef?: Ref<GroupHandle | null>
  /** id → 0..100 百分比；优先于各 pane 的 defaultSize 合成 */
  defaultLayout?: Record<string, number>
  onLayoutChanged?: (layout: Record<string, number>, meta?: LayoutChangeMeta) => void
  onCollapse?: (
    collapsedById: Record<string, boolean>,
    layout: Record<string, number>
  ) => void
  disabled?: boolean
  /** 程序化改布局时关掉 pane 过渡 */
  freezeTransition?: boolean
  collapseIcon?: { start?: ReactNode; end?: ReactNode }
}

interface SplitterPaneProps {
  id: string
  children?: ReactNode
  className?: string
  style?: CSSProperties
  defaultSize?: SizeValue
  min?: SizeValue
  max?: SizeValue
  /** 折叠后保留的像素高度/宽度；默认 0 */
  collapsedSize?: number
  collapsible?: boolean | PaneCollapsibleConfig
  /** 窗口伸缩时尽量保持像素宽 */
  preservePixel?: boolean
  resizable?: boolean
  paneRef?: Ref<PaneHandle | null>
  destroyOnHidden?: boolean
  onResize?: () => void
}

interface SplitterHandleProps {
  withHandle?: boolean
  className?: string
  disabled?: boolean
  disableDoubleClick?: boolean
  collapse?: {
    start?: CollapseSideConfig
    end?: CollapseSideConfig
  }
}

interface PaneItem {
  id: string
  defaultSize?: SizeValue
  min?: SizeValue
  max?: SizeValue
  collapsedSize: number
  collapsible: PaneCollapsibleConfig
  preservePixel: boolean
  resizable: boolean
  destroyOnHidden: boolean
  className?: string
  style?: CSSProperties
  paneRef?: Ref<PaneHandle | null>
  onResize?: () => void
  children?: ReactNode
}

interface HandleItem {
  withHandle: boolean
  className?: string
  disabled: boolean
  disableDoubleClick: boolean
  collapse?: SplitterHandleProps['collapse']
}

export type {
  CollapsePosition,
  CollapseRenderContext,
  CollapseSideConfig,
  CollapseVisible,
  GroupHandle,
  HandleItem,
  LayoutChangeMeta,
  PaneCollapsibleConfig,
  PaneHandle,
  PaneItem,
  SizeValue,
  SplitterHandleProps,
  SplitterPaneProps,
  SplitterProps
}
