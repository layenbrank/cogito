import { Icon } from '@iconify/react/offline'
import { useScrollLock } from '@assistant-ui/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { memo, useCallback, useRef, useState, type FC, type PropsWithChildren } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { useCollapseScrollPin } from './collapse-scroll-pin'
import { useAssistantLabels } from './labels'

import { CHAT_DURATION_MS, CHAT_EASE_CLASS } from './chat-motion'

const ANIMATION_DURATION = CHAT_DURATION_MS

/** 默认 ghost：与 Cursor「N tool calls」扁平行一致 */
const toolGroupVariants = cva('aui-tool-group-root group/tool-group w-full', {
  variants: {
    variant: {
      outline: 'rounded-lg border py-3',
      ghost: 'mb-0.5',
      muted: 'border-muted-foreground/30 bg-muted/30 rounded-lg border py-3'
    }
  },
  defaultVariants: { variant: 'ghost' }
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
      data-variant={variant ?? 'outline'}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(toolGroupVariants({ variant }), 'group/tool-group-root', className)}
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
  active?: boolean
}) {
  const labels = useAssistantLabels()
  const text = label ?? labels.toolCalls(count, failed)

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      className={cn(
        'aui-tool-group-trigger group/trigger flex origin-left items-center gap-1.5 text-xs transition-colors active:text-foreground',
        'group-data-[variant=ghost]/tool-group-root:text-muted-foreground group-data-[variant=ghost]/tool-group-root:hover:text-foreground group-data-[variant=ghost]/tool-group-root:py-1',
        'group-data-[variant=outline]/tool-group-root:w-full group-data-[variant=outline]/tool-group-root:px-4 group-data-[variant=outline]/tool-group-root:text-sm',
        'group-data-[variant=muted]/tool-group-root:w-full group-data-[variant=muted]/tool-group-root:px-4 group-data-[variant=muted]/tool-group-root:text-sm',
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
          'aui-tool-group-trigger-label-wrapper inline-block text-start leading-none',
          'group-data-[variant=ghost]/tool-group-root:font-normal',
          'group-data-[variant=outline]/tool-group-root:grow group-data-[variant=outline]/tool-group-root:font-medium',
          'group-data-[variant=muted]/tool-group-root:grow group-data-[variant=muted]/tool-group-root:font-medium',
          active && 'shimmer motion-reduce:animate-none'
        )}>
        {text}
      </span>
      <Icon
        icon="lucide:chevron-down"
        data-slot="tool-group-trigger-chevron"
        className={cn(
          'aui-tool-group-trigger-chevron size-3.5 shrink-0 opacity-70',
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
 * on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>` with
 * a `groupBy` returning `"group-tool"` and compose `ToolGroupRoot` /
 * `ToolGroupTrigger` / `ToolGroupContent` directly. See `thread.tsx`.
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent

ToolGroup.displayName = 'ToolGroup'
ToolGroup.Root = ToolGroupRoot
ToolGroup.Trigger = ToolGroupTrigger
ToolGroup.Content = ToolGroupContent

export { ToolGroup, ToolGroupContent, ToolGroupRoot, ToolGroupTrigger, toolGroupVariants }
