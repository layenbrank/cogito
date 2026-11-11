/**
 * Tool group（对齐 assistant-ui `elements/tool-group`）
 *
 * 一轮里**连续几次工具调用**收成一行：一个次数、跑着时的状态图标、一个展开箭头。
 * 分组只在一轮的连续工具调用之间成立 —— 所以这里只有 Root / Trigger / Content 三块，
 * 由宿主（`ThreadComponents.ToolGroup`）决定把哪几件收进来。
 *
 * 三档外观只改「壳」，不改行内结构：
 * - `outline`（**默认**，元素页的 default）：`rounded-lg border py-3`，带内边距的描边卡；
 * - `ghost`（`Thread` 用它）：无描边、无底色，一行灰字，悬停才转前景色；
 * - `muted`：描边 + `bg-muted/30` 的弱底卡。
 *
 * 两个行为口径：
 * - 折叠时锁住滚动位置（展开锁 `scrollTop`，收起钉住折叠条），高度变化不许把视口顶跑；
 * - 展开时子项**逐个**淡入上移，延迟从第一个到第五个递增，第六个起共用最后一档。
 */
import { Icon } from '@iconify/react/offline'
import { useScrollLock } from '@assistant-ui/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { memo, useCallback, useRef, useState, type FC, type PropsWithChildren } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { CHAT_DURATION_MS, CHAT_EASE_CLASS } from './chat-motion'
import { useCollapseScrollPin } from './collapse-scroll-pin'
import { useAssistantLabels } from './labels'

const ANIMATION_DURATION = CHAT_DURATION_MS

/** 展开时子项的入场错峰：第 1…5 个依次 +40ms，第六个起共用最后一档 */
const STAGGER_STEP_MS = 40
const STAGGER_CLASS = cn(
  '[&>*]:motion-safe:animate-in [&>*]:motion-safe:fade-in [&>*]:motion-safe:slide-in-from-bottom-1',
  '[&>*]:motion-safe:fill-mode-both [&>*]:motion-safe:duration-200',
  '[&>*:nth-child(2)]:[animation-delay:40ms]',
  '[&>*:nth-child(3)]:[animation-delay:80ms]',
  '[&>*:nth-child(4)]:[animation-delay:120ms]',
  `[&>*:nth-child(n+5)]:[animation-delay:${STAGGER_STEP_MS * 4}ms]`
)

const toolGroupVariants = cva('aui-tool-group-root group/tool-group w-full', {
  variants: {
    variant: {
      /** 元素页的 default：描边卡 + 内边距 */
      outline: 'rounded-lg border py-3',
      /** `Thread` 用的那一档：没有壳，只有一行「N tool calls」 */
      ghost: 'mb-0.5',
      muted: 'border-muted-foreground/30 bg-muted/30 rounded-lg border py-3'
    }
  },
  defaultVariants: { variant: 'outline' }
})

export type ToolGroupRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> &
  VariantProps<typeof toolGroupVariants> & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    defaultOpen?: boolean
  }

function ToolGroupRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolGroupRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)
  const armCollapsePin = useCollapseScrollPin(collapsibleRef)

  // 类名与 `data-variant` 必须说同一件事：缺省是 outline，回落到 ghost 会让
  // 「看着是 ghost、选中的是 outline」这种错配在 CSS 里静默发生
  const resolved = variant ?? 'outline'
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // 展开：锁 scrollTop，避免贴底 followBottom 把内容往上抽
      // 收起：钉住折叠条（冻 scrollTop 在贴底会更抖）
      if (open) lockScroll()
      else armCollapsePin(ANIMATION_DURATION)
      if (!isControlled) {
        setUncontrolledOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [lockScroll, armCollapsePin, isControlled, controlledOnOpenChange]
  )

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-group-root"
      data-variant={resolved}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(toolGroupVariants({ variant: resolved }), 'group/tool-group-root', className)}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
      {...props}>
      {children}
    </Collapsible>
  )
}

function ToolGroupTrigger({
  count,
  failed,
  label,
  active = false,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  count: number
  /** 其中失败的次数；0 / undefined 时不播报失败 */
  failed?: number
  /** 覆盖折叠条文案（默认走 `labels.toolCalls`）；app 用它表达「不显示次数」这类偏好 */
  label?: React.ReactNode
  /** 组里还有调用在跑：转圈 + 文案 shimmer */
  active?: boolean
}) {
  const labels = useAssistantLabels()
  const text = label ?? labels.toolCalls(count, failed)

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      className={cn(
        'aui-tool-group-trigger group/trigger flex origin-left items-center gap-2 text-sm',
        'transition-[color,scale] active:scale-[0.98] motion-reduce:transition-none',
        'group-data-[variant=ghost]/tool-group-root:text-muted-foreground group-data-[variant=ghost]/tool-group-root:hover:text-foreground group-data-[variant=ghost]/tool-group-root:py-1.5',
        'group-data-[variant=outline]/tool-group-root:w-full group-data-[variant=outline]/tool-group-root:px-4',
        'group-data-[variant=muted]/tool-group-root:w-full group-data-[variant=muted]/tool-group-root:px-4',
        className
      )}
      {...props}>
      {active ? (
        <Icon
          icon="lucide:loader"
          data-slot="tool-group-trigger-loader"
          className="aui-tool-group-trigger-loader size-3 shrink-0 animate-spin [animation-duration:0.6s]"
        />
      ) : null}
      <span
        data-slot="tool-group-trigger-label"
        className={cn(
          'aui-tool-group-trigger-label-wrapper inline-block text-start text-xs leading-none font-medium',
          'group-data-[variant=ghost]/tool-group-root:font-normal',
          'group-data-[variant=outline]/tool-group-root:grow',
          'group-data-[variant=muted]/tool-group-root:grow',
          active && 'shimmer shimmer-contrast motion-reduce:animate-none'
        )}>
        {text}
      </span>
      <Icon
        icon="lucide:chevron-down"
        data-slot="tool-group-trigger-chevron"
        className={cn(
          'aui-tool-group-trigger-chevron size-3 shrink-0 opacity-70',
          `transition-transform duration-(--animation-duration) ${CHAT_EASE_CLASS} motion-reduce:transition-none`,
          '-rotate-90',
          'group-data-open/trigger:rotate-0',
          'group-data-panel-open/trigger:rotate-0'
        )}
      />
    </CollapsibleTrigger>
  )
}

function ToolGroupContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      className={cn(
        'aui-tool-group-content relative overflow-hidden text-sm outline-none',
        'group/collapsible-content data-closed:pointer-events-none',
        className
      )}
      {...props}>
      <div
        className={cn(
          'mt-2 flex flex-col gap-2',
          STAGGER_CLASS,
          'group-data-[variant=ghost]/tool-group-root:mt-1 group-data-[variant=ghost]/tool-group-root:gap-1',
          'group-data-[variant=outline]/tool-group-root:mt-3 group-data-[variant=outline]/tool-group-root:border-t group-data-[variant=outline]/tool-group-root:px-4 group-data-[variant=outline]/tool-group-root:pt-3',
          'group-data-[variant=muted]/tool-group-root:mt-3 group-data-[variant=muted]/tool-group-root:border-t group-data-[variant=muted]/tool-group-root:px-4 group-data-[variant=muted]/tool-group-root:pt-3'
        )}>
        {children}
      </div>
    </CollapsibleContent>
  )
}

type ToolGroupComponent = FC<PropsWithChildren<{ startIndex: number; endIndex: number }>> & {
  Root: typeof ToolGroupRoot
  Trigger: typeof ToolGroupTrigger
  Content: typeof ToolGroupContent
}

const ToolGroupImpl: FC<PropsWithChildren<{ startIndex: number; endIndex: number }>> = ({
  children,
  startIndex,
  endIndex
}) => {
  const toolCount = endIndex - startIndex + 1

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  )
}

/**
 * @deprecated This wrapper targets the legacy `components.ToolGroup` prop
 * on `<MessagePrimitive.Parts>`. Use the three pieces above and compose them
 * yourself (see `thread.aui.tsx` / `components/tool-group.tsx`).
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent

ToolGroup.displayName = 'ToolGroup'
ToolGroup.Root = ToolGroupRoot
ToolGroup.Trigger = ToolGroupTrigger
ToolGroup.Content = ToolGroupContent

export { ToolGroup, ToolGroupContent, ToolGroupRoot, ToolGroupTrigger, toolGroupVariants }
