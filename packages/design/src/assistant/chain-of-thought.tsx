/**
 * AI Elements Chain of Thought — step timeline UI.
 *
 * **Mapping:** `@cogito/design/assistant/reasoning` covers streaming model
 * reasoning parts (assistant-ui). Use ChainOfThought for explicit multi-step
 * thought timelines in custom UIs; do not duplicate Reasoning primitives.
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, memo, useCallback, useContext, useMemo, useState } from 'react'

import { Badge } from '../components/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'

interface ChainOfThoughtContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null)

function useChainOfThought() {
  const context = useContext(ChainOfThoughtContext)
  if (!context) {
    throw new Error('ChainOfThought components must be used within ChainOfThought')
  }
  return context
}

type ChainOfThoughtProps = ComponentProps<'div'> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

const ChainOfThought = memo(function ChainOfThought({
  className,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ChainOfThoughtProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const setIsOpen = useCallback(
    function (next: boolean) {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )

  const chainOfThoughtContext = useMemo(
    function () {
      return { isOpen, setIsOpen }
    },
    [isOpen, setIsOpen]
  )

  return (
    <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
      <div
        data-slot="chain-of-thought"
        className={cn('not-prose w-full space-y-4', className)}
        {...props}>
        {children}
      </div>
    </ChainOfThoughtContext.Provider>
  )
})

type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger>

const ChainOfThoughtHeader = memo(function ChainOfThoughtHeader({
  className,
  children,
  ...props
}: ChainOfThoughtHeaderProps) {
  const { isOpen, setIsOpen } = useChainOfThought()

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className={cn(
          'text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-sm transition-colors',
          className
        )}
        {...props}>
        <Icon
          icon="lucide:brain"
          className="size-4"
        />
        <span className="flex-1 text-left">{children ?? 'Chain of Thought'}</span>
        <Icon
          icon="lucide:chevron-down"
          className={cn('size-4 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
        />
      </CollapsibleTrigger>
    </Collapsible>
  )
})

type ChainOfThoughtStepProps = ComponentProps<'div'> & {
  icon?: string
  label: ReactNode
  description?: ReactNode
  status?: 'complete' | 'active' | 'pending'
}

const STEP_STATUS_STYLES = {
  active: 'text-foreground',
  complete: 'text-muted-foreground',
  pending: 'text-muted-foreground/50'
}

const ChainOfThoughtStep = memo(function ChainOfThoughtStep({
  className,
  icon = 'lucide:circle-dot',
  label,
  description,
  status = 'complete',
  children,
  ...props
}: ChainOfThoughtStepProps) {
  return (
    <div
      className={cn(
        'flex gap-2 text-sm',
        STEP_STATUS_STYLES[status],
        'animate-in fade-in-0 slide-in-from-top-2',
        className
      )}
      {...props}>
      <div className="relative mt-0.5">
        <Icon
          icon={icon}
          className="size-4"
        />
        <div className="bg-border absolute top-7 bottom-0 left-1/2 -mx-px w-px" />
      </div>
      <div className="flex-1 space-y-2 overflow-hidden">
        <div>{label}</div>
        {description ? <div className="text-muted-foreground text-xs">{description}</div> : null}
        {children}
      </div>
    </div>
  )
})

type ChainOfThoughtSearchResultsProps = ComponentProps<'div'>

const ChainOfThoughtSearchResults = memo(function ChainOfThoughtSearchResults({
  className,
  ...props
}: ChainOfThoughtSearchResultsProps) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
})

type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>

const ChainOfThoughtSearchResult = memo(function ChainOfThoughtSearchResult({
  className,
  children,
  ...props
}: ChainOfThoughtSearchResultProps) {
  return (
    <Badge
      className={cn('gap-1 px-2 py-0.5 text-xs font-normal', className)}
      variant="secondary"
      {...props}>
      {children}
    </Badge>
  )
})

type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>

const ChainOfThoughtContent = memo(function ChainOfThoughtContent({
  className,
  children,
  ...props
}: ChainOfThoughtContentProps) {
  const { isOpen } = useChainOfThought()

  return (
    <Collapsible open={isOpen}>
      <CollapsibleContent
        className={cn('mt-2 space-y-3 outline-none', className)}
        {...props}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
})

type ChainOfThoughtImageProps = ComponentProps<'div'> & {
  caption?: string
}

const ChainOfThoughtImage = memo(function ChainOfThoughtImage({
  className,
  children,
  caption,
  ...props
}: ChainOfThoughtImageProps) {
  return (
    <div
      className={cn('mt-2 space-y-2', className)}
      {...props}>
      <div className="bg-muted relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg p-3">
        {children}
      </div>
      {caption ? <p className="text-muted-foreground text-xs">{caption}</p> : null}
    </div>
  )
})

export {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep
}
