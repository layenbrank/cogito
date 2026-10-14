import { Icon } from '@iconify/react/offline'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { useAssistantLabels } from './labels'

export const ANIMATION_DURATION = 200

const ReasoningPreviewContext = createContext(false)

/** 默认 ghost：对齐 Cursor / Copilot 扁平折叠行，无卡片边框 */
const reasoningVariants = cva('aui-reasoning-root w-full', {
  variants: {
    variant: {
      outline: 'mb-3 rounded-lg border px-3 py-2',
      ghost: 'mb-0.5',
      muted: 'mb-2 rounded-lg bg-muted/50 px-3 py-2'
    }
  },
  defaultVariants: {
    variant: 'ghost'
  }
})

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    defaultOpen?: boolean
    /**
     * Whether the reasoning is currently streaming. While `true` the
     * disclosure is held open with a bottom-pinned live preview; when
     * streaming ends it returns to `defaultOpen`, and the first manual
     * toggle takes over the open/close state permanently. The live preview
     * keeps following the newest tokens while the disclosure is open during
     * streaming, even after a manual toggle, and pauses while the reader is
     * scrolled up.
     */
    streaming?: boolean
    /** Called right before the disclosure animates, on toggle and on streaming transitions. */
    onAnimationStart?: () => void
  }

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  streaming,
  onAnimationStart,
  children,
  ...props
}: ReasoningRootProps) {
  const [initialOpen] = useState(defaultOpen)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : (userOpen ?? (streaming || initialOpen))
  const isPreview = streaming === true && isOpen

  const prevStreamingRef = useRef(streaming)
  useLayoutEffect(() => {
    if (prevStreamingRef.current === streaming) return
    prevStreamingRef.current = streaming
    // A streaming transition only animates the panel when the resting state
    // is collapsed; with `defaultOpen` the disclosure stays open across it.
    if (!isControlled && userOpen === null && !initialOpen) {
      onAnimationStart?.()
    }
  }, [streaming, isControlled, userOpen, initialOpen, onAnimationStart])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onAnimationStart?.()
      if (!isControlled) {
        setUserOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [onAnimationStart, isControlled, controlledOnOpenChange]
  )

  return (
    <Collapsible
      data-slot="reasoning-root"
      data-variant={variant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('group/reasoning-root', reasoningVariants({ variant, className }))}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
      {...props}>
      <ReasoningPreviewContext.Provider value={isPreview}>
        {children}
      </ReasoningPreviewContext.Provider>
    </Collapsible>
  )
}

function ReasoningFade({
  side = 'bottom',
  className,
  ...props
}: React.ComponentProps<'div'> & { side?: 'top' | 'bottom' }) {
  if (side === 'top') {
    return (
      <div
        data-slot="reasoning-fade"
        className={cn(
          'aui-reasoning-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-8',
          'bg-[linear-gradient(to_bottom,var(--color-background),transparent)]',
          'group-data-[variant=muted]/reasoning-root:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--color-muted)_50%,var(--color-background)),transparent)]',
          'fade-in-0 animate-in',
          'animation-duration-(--animation-duration)',
          className
        )}
        {...props}
      />
    )
  }

  return (
    <div
      data-slot="reasoning-fade"
      className={cn(
        'aui-reasoning-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8',
        'bg-[linear-gradient(to_top,var(--color-background),transparent)]',
        'group-data-[variant=muted]/reasoning-root:bg-[linear-gradient(to_top,color-mix(in_oklab,var(--color-muted)_50%,var(--color-background)),transparent)]',
        'fade-in-0 animate-in',
        'animation-duration-(--animation-duration)',
        className
      )}
      {...props}
    />
  )
}

function ReasoningTrigger({
  active,
  duration,
  label,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean
  duration?: number
  /** 覆盖文案。过程折叠条拿它换成「过程」那套说法，不用再拼一个 trigger */
  label?: string
}) {
  const labels = useAssistantLabels()

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      className={cn(
        // 扁平行：弱色正文 + 小 chevron，勿做成卡片头
        'aui-reasoning-trigger group/trigger text-muted-foreground hover:text-foreground active:text-foreground flex max-w-[85%] origin-left items-center gap-1.5 py-1 text-xs transition-colors',
        className
      )}
      {...props}>
      <span
        data-slot="reasoning-trigger-label"
        className={cn(
          'aui-reasoning-trigger-label-wrapper inline-block leading-none tabular-nums',
          active && 'shimmer motion-reduce:animate-none'
        )}>
        {label ?? labels.reasoning(duration)}
      </span>
      <Icon
        icon="lucide:chevron-down"
        data-slot="reasoning-trigger-chevron"
        className={cn(
          'aui-reasoning-trigger-chevron size-3.5 shrink-0 opacity-70',
          'transition-transform duration-(--animation-duration) ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
          '-rotate-90',
          'group-data-open/trigger:rotate-0',
          'group-data-panel-open/trigger:rotate-0'
        )}
      />
    </CollapsibleTrigger>
  )
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  const isPreview = useContext(ReasoningPreviewContext)

  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        'aui-reasoning-content text-muted-foreground relative overflow-hidden text-sm outline-none',
        'group/collapsible-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none',
        'data-closed:animate-collapsible-up',
        'data-open:animate-collapsible-down',
        'data-closed:fill-mode-forwards',
        'data-closed:pointer-events-none',
        '[--tw-duration:var(--animation-duration)]',
        className
      )}
      {...props}>
      <ReasoningFade side="top" />
      {children}
      {isPreview ? <ReasoningFade /> : null}
    </CollapsibleContent>
  )
}

function ReasoningText({ className, children, ...props }: React.ComponentProps<'div'>) {
  const isPreview = useContext(ReasoningPreviewContext)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isPreview) return
    const scrollEl = scrollRef.current
    const contentEl = contentRef.current
    if (!scrollEl || !contentEl) return

    let pinned = true
    let lastScrollTop = scrollEl.scrollTop
    let lastScrollHeight = scrollEl.scrollHeight
    const isAtBottom = () =>
      Math.abs(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) <= 1 ||
      scrollEl.scrollHeight <= scrollEl.clientHeight

    const pin = () => {
      if (!pinned) return
      scrollEl.scrollTop = scrollEl.scrollHeight
    }
    // A pin's own scroll event can arrive after new content grew the scroll
    // height and read as "not at bottom"; only an upward move at unchanged
    // scroll height is user intent.
    const onScroll = () => {
      if (isAtBottom()) {
        pinned = true
      } else if (scrollEl.scrollTop < lastScrollTop && scrollEl.scrollHeight === lastScrollHeight) {
        pinned = false
      }
      lastScrollTop = scrollEl.scrollTop
      lastScrollHeight = scrollEl.scrollHeight
    }

    pin()
    scrollEl.addEventListener('scroll', onScroll)
    const observer = new ResizeObserver(pin)
    observer.observe(contentEl)
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [isPreview])

  return (
    <div
      ref={scrollRef}
      data-slot="reasoning-text"
      className={cn(
        // 扁平行内正文：轻缩进、小间距；高度抬到视口比例以容纳工具终端
        'aui-reasoning-text relative z-0 max-h-[min(60vh,32rem)] overflow-y-auto ps-3 pt-0.5 pb-1 text-xs leading-relaxed text-pretty',
        'transform-gpu transition-[transform,opacity] ease-[cubic-bezier(0.32,0.72,0,1)]',
        'motion-reduce:animate-none',
        'group-data-open/collapsible-content:animate-in',
        'group-data-closed/collapsible-content:animate-out',
        'group-data-open/collapsible-content:fade-in-0',
        'group-data-closed/collapsible-content:fade-out-0',
        'group-data-open/collapsible-content:slide-in-from-top-2',
        'group-data-closed/collapsible-content:slide-out-to-top-2',
        'group-data-open/collapsible-content:animation-duration-(--animation-duration)',
        'group-data-closed/collapsible-content:animation-duration-(--animation-duration)',
        className
      )}
      {...props}>
      <div
        ref={contentRef}
        className="aui-reasoning-text-content space-y-1">
        {children}
      </div>
    </div>
  )
}

export {
  ReasoningContent,
  ReasoningFade,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
  reasoningVariants
}
