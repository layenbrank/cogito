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

/**
 * 折叠钮的默认字形：一片**异形**的波浪剪影（不是线、也不套方框）。
 *
 * - 形体本身就是要点的东西：上下两个波峰一左一右，像一片被风掀起来的叶子 / 一段水流；
 * - 竖向分隔条（`orientation === 'horizontal'`）上是竖剪影；横向分隔条转 90°；
 * - 波峰朝向**会被收起的那一侧**：`start` 侧收起时上峰朝左、展开时朝右，`end` 侧相反 ——
 *   方向由镜像给出，不必再画箭头；
 * - 填充用 `currentColor`，颜色由钮的状态给（default → hover → active）。
 */
function CollapseWave(props: {
  orientation: 'horizontal' | 'vertical'
  side: 'start' | 'end'
  isExpandAction: boolean
}) {
  // 收起 = 朝向本侧，展开 = 朝向另一侧；`start` 侧不镜像，`end` 侧镜像
  const mirrored = (props.side === 'start') === props.isExpandAction
  return (
    <svg
      data-slot="splitter-collapse-wave"
      viewBox="0 0 10 34"
      aria-hidden
      className={cn(
        'h-7 w-2.5',
        props.orientation === 'vertical' && 'rotate-90',
        mirrored && '-scale-x-100'
      )}>
      {/* 上下两个波峰反向：上峰朝右、下峰朝左，中段收成一点 */}
      <path
        d="M5 0C9.4 7 9.4 11 5 17C0.6 23 0.6 27 5 34C9.4 27 9.4 23 5 17C0.6 11 0.6 7 5 0Z"
        fill="currentColor"
        fillOpacity="0.55"
      />
    </svg>
  )
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

  const icon = config?.icon ?? globalIcon ?? (
    <CollapseWave
      orientation={orientation}
      side={side}
      isExpandAction={isExpandAction}
    />
  )

  return (
    <button
      type="button"
      tabIndex={0}
      aria-label={isExpandAction ? '展开面板' : '折叠面板'}
      className={cn(
        // 不画框也不画底：异形剪影自己就是按钮，只留一块透明热区。
        // 竖向分隔条上热区是竖的，横向分隔条上是横的（内容转 90°）。
        'text-muted-foreground hover:text-foreground absolute z-20 flex items-center justify-center rounded-md transition-[opacity,color]',
        orientation === 'horizontal' ? 'h-10 w-4' : 'h-4 w-10',
        'hover:bg-foreground/[0.04]',
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
  const handleState = disabled ? 'disabled' : isActive ? 'active' : isHovered ? 'hover' : 'inactive'

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
        'group/splitter-handle relative flex shrink-0 items-center justify-center',
        'bg-border',
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
