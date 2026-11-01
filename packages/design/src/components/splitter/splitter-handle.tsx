import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { markHandleType } from './parse-children'
import type {
  CollapseRenderContext,
  CollapseSideConfig,
  CollapseVisible,
  SplitterHandleProps
} from './types'

interface SplitterHandleViewProps {
  index: number
  orientation: 'horizontal' | 'vertical'
  withHandle?: boolean
  className?: string
  disabled?: boolean
  disableDoubleClick?: boolean
  isActive?: boolean
  isHovered?: boolean
  ariaNow: number
  ariaMin: number
  ariaMax: number
  canResize: boolean
  startCollapsible: boolean
  endCollapsible: boolean
  /** true = 点击为展开动作（图标/文案按展开） */
  startCollapsed: boolean
  endCollapsed: boolean
  collapseConfig?: SplitterHandleProps['collapse']
  collapseIcon?: { start?: ReactNode; end?: ReactNode }
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, index: number) => void
  onPointerEnter: () => void
  onPointerLeave: () => void
  onCollapseStart: () => void
  onCollapseEnd: () => void
}

const HIT = 'after:absolute after:bg-transparent'

function findVisibilityClass(mode: CollapseVisible | undefined, isExpandAction: boolean): string {
  // 展开钮常显，否则折叠后很难发现
  if (isExpandAction) return 'opacity-100'
  if (mode === true) return 'opacity-100'
  if (mode === false) return 'hidden'
  return 'opacity-0 group-hover/splitter-handle:opacity-100 group-data-[splitter-handle=active]/splitter-handle:opacity-100 group-data-[splitter-handle=hover]/splitter-handle:opacity-100 focus-visible:opacity-100'
}

function findPositionClass(
  orientation: 'horizontal' | 'vertical',
  side: 'start' | 'end',
  position: CollapseSideConfig['position']
): string {
  const isHorizontal = orientation === 'horizontal'
  if (isHorizontal) {
    const x = side === 'start' ? 'right-full mr-0.5' : 'left-full ml-0.5'
    if (position === 'start') return `${x} top-2`
    if (position === 'end') return `${x} bottom-2`
    return `${x} top-1/2 -translate-y-1/2`
  }
  const y = side === 'start' ? 'bottom-full mb-0.5' : 'top-full mt-0.5'
  if (position === 'start') return `${y} left-2`
  if (position === 'end') return `${y} right-2`
  return `${y} left-1/2 -translate-x-1/2`
}

function CollapseButton(props: {
  side: 'start' | 'end'
  orientation: 'horizontal' | 'vertical'
  config?: CollapseSideConfig
  globalIcon?: ReactNode
  isExpandAction: boolean
  onAction: () => void
}) {
  const { side, orientation, config, globalIcon, isExpandAction, onAction } = props
  const visible = config?.visible ?? 'auto'
  const position = config?.position ?? 'center'

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onAction()
    }
  }

  const ctx: CollapseRenderContext = {
    side,
    isCollapsed: isExpandAction,
    collapse: onAction,
    expand: onAction
  }

  if (config?.render) {
    return (
      <div
        className={cn(
          'absolute z-20',
          findPositionClass(orientation, side, position),
          findVisibilityClass(visible, isExpandAction),
          config.className
        )}>
        {config.render(ctx)}
      </div>
    )
  }

  let icon = config?.icon ?? globalIcon
  if (!icon) {
    if (orientation === 'horizontal') {
      const name =
        side === 'start'
          ? isExpandAction
            ? 'lucide:chevron-right'
            : 'lucide:chevron-left'
          : isExpandAction
            ? 'lucide:chevron-left'
            : 'lucide:chevron-right'
      icon = <Icon icon={name} className="size-3.5" />
    } else {
      const name =
        side === 'start'
          ? isExpandAction
            ? 'lucide:chevron-down'
            : 'lucide:chevron-up'
          : isExpandAction
            ? 'lucide:chevron-up'
            : 'lucide:chevron-down'
      icon = <Icon icon={name} className="size-3.5" />
    }
  }

  return (
    <button
      type="button"
      tabIndex={0}
      aria-label={isExpandAction ? '展开面板' : '折叠面板'}
      className={cn(
        // 黑白中性：跟主题 token，不绑 primary
        'bg-background text-foreground border-border hover:bg-muted absolute z-20 flex size-5 items-center justify-center rounded-sm border shadow-sm transition-[opacity,background-color,color]',
        'focus-visible:ring-foreground/20 focus-visible:ring-1 focus-visible:outline-hidden',
        findPositionClass(orientation, side, position),
        findVisibilityClass(visible, isExpandAction),
        config?.className
      )}
      onClick={function (event) {
        event.stopPropagation()
        onAction()
      }}
      onPointerDown={function (event) {
        // 阻止冒泡到 separator 开始拖拽；仍允许按钮自身获得焦点
        event.stopPropagation()
      }}
      onKeyDown={handleKeyDown}>
      {icon}
    </button>
  )
}

function SplitterHandleView(props: SplitterHandleViewProps) {
  const {
    index,
    orientation,
    withHandle,
    className,
    disabled,
    isActive,
    isHovered,
    ariaNow,
    ariaMin,
    ariaMax,
    canResize,
    startCollapsible,
    endCollapsible,
    startCollapsed,
    endCollapsed,
    collapseConfig,
    collapseIcon,
    onPointerDown,
    onPointerEnter,
    onPointerLeave,
    onCollapseStart,
    onCollapseEnd
  } = props

  const isHorizontal = orientation === 'horizontal'
  const handleState = disabled
    ? 'disabled'
    : isActive
      ? 'active'
      : isHovered
        ? 'hover'
        : 'inactive'

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(ariaNow)}
      aria-valuemin={Math.round(ariaMin)}
      aria-valuemax={Math.round(ariaMax)}
      aria-disabled={!canResize || disabled}
      data-slot="splitter-handle"
      data-splitter-handle={handleState}
      className={cn(
        'group/splitter-handle bg-border relative flex shrink-0 items-center justify-center',
        isHorizontal
          ? cn(
              'w-px',
              HIT,
              'after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
              canResize && !disabled && 'cursor-col-resize'
            )
          : cn(
              'h-px w-full',
              HIT,
              'after:inset-x-0 after:top-1/2 after:h-1 after:-translate-y-1/2',
              canResize && !disabled && 'cursor-row-resize'
            ),
        // 悬停/拖拽用前景色阶，适配亮暗主题
        handleState === 'hover' && 'bg-foreground/35',
        handleState === 'active' && 'bg-foreground/55',
        handleState === 'disabled' && 'opacity-40',
        className
      )}
      onPointerDown={function (event) {
        if (!canResize || disabled) return
        onPointerDown(event, index)
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}>
      {withHandle && (
        <div
          className={cn(
            'bg-muted-foreground/40 z-10 flex shrink-0 rounded-sm transition-colors',
            isHorizontal ? 'h-6 w-1' : 'h-1 w-6',
            'group-data-[splitter-handle=hover]/splitter-handle:bg-foreground/50',
            'group-data-[splitter-handle=active]/splitter-handle:bg-foreground/70'
          )}
        />
      )}

      {startCollapsible && (
        <CollapseButton
          side="start"
          orientation={orientation}
          config={collapseConfig?.start}
          globalIcon={collapseIcon?.start}
          isExpandAction={startCollapsed}
          onAction={onCollapseStart}
        />
      )}
      {endCollapsible && (
        <CollapseButton
          side="end"
          orientation={orientation}
          config={collapseConfig?.end}
          globalIcon={collapseIcon?.end}
          isExpandAction={endCollapsed}
          onAction={onCollapseEnd}
        />
      )}
    </div>
  )
}

/** 占位组件：仅用于 Splitter children 声明，真正渲染由根组件完成 */
function SplitterHandle(_props: SplitterHandleProps) {
  return null
}

markHandleType(SplitterHandle)

export { SplitterHandle, SplitterHandleView }
