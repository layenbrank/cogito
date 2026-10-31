/**
 * Model context window usage (AI Elements `Context`).
 * Token cost rows are optional — no `tokenlens` / `@ai-sdk/*` dependency.
 */
import { cn } from 'cn'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'

import { Button } from '../components/button'
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover'
import { Progress } from '../components/progress'

const PERCENT_MAX = 100
const ICON_RADIUS = 10
const ICON_VIEWBOX = 24
const ICON_CENTER = 12
const ICON_STROKE_WIDTH = 2

interface ModelUsageBreakdown {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

interface ModelContextSchema {
  usedTokens: number
  maxTokens: number
  usage?: ModelUsageBreakdown
  /** Optional model id for app-side cost formatting */
  modelId?: string
  /** Optional preformatted total cost label */
  totalCostLabel?: string
}

const ModelContextState = createContext<ModelContextSchema | null>(null)

function useModelContext() {
  const context = useContext(ModelContextState)
  if (!context) {
    throw new Error('Context components must be used within Context')
  }
  return context
}

type ContextProps = ComponentProps<typeof Popover> & ModelContextSchema

function Context({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  totalCostLabel,
  ...props
}: ContextProps) {
  const contextValue = useMemo(
    function () {
      return { maxTokens, modelId, usage, usedTokens, totalCostLabel }
    },
    [maxTokens, modelId, usage, usedTokens, totalCostLabel]
  )

  return (
    <ModelContextState.Provider value={contextValue}>
      <Popover
        data-slot="model-context"
        {...props}
      />
    </ModelContextState.Provider>
  )
}

function ContextUsageIcon() {
  const { usedTokens, maxTokens } = useModelContext()
  const circumference = 2 * Math.PI * ICON_RADIUS
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0
  const dashOffset = circumference * (1 - usedPercent)

  return (
    <svg
      aria-label="Model context usage"
      height="20"
      role="img"
      style={{ color: 'currentcolor' }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20">
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />
    </svg>
  )
}

type ContextTriggerProps = ComponentProps<typeof Button>

function ContextTrigger({ children, ...props }: ContextTriggerProps) {
  const { usedTokens, maxTokens } = useModelContext()
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0
  const renderedPercent = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1,
    style: 'percent'
  }).format(usedPercent)

  if (children) {
    return <PopoverTrigger render={children as ReactElement} />
  }

  return (
    <PopoverTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          {...props}
        />
      }>
      <span className="text-muted-foreground font-medium">{renderedPercent}</span>
      <ContextUsageIcon />
    </PopoverTrigger>
  )
}

type ContextContentProps = ComponentProps<typeof PopoverContent>

function ContextContent({ className, ...props }: ContextContentProps) {
  return (
    <PopoverContent
      className={cn('min-w-60 divide-y overflow-hidden p-0', className)}
      data-slot="model-context-content"
      {...props}
    />
  )
}

type ContextContentHeaderProps = ComponentProps<'div'>

function ContextContentHeader({ children, className, ...props }: ContextContentHeaderProps) {
  const { usedTokens, maxTokens } = useModelContext()
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0
  const displayPct = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1,
    style: 'percent'
  }).format(usedPercent)
  const used = new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(usedTokens)
  const total = new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(maxTokens)

  return (
    <div
      className={cn('w-full space-y-2 p-3', className)}
      {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{displayPct}</p>
            <p className="text-muted-foreground font-mono">
              {used} / {total}
            </p>
          </div>
          <Progress
            className="bg-muted"
            value={usedPercent * PERCENT_MAX}
          />
        </>
      )}
    </div>
  )
}

type ContextContentBodyProps = ComponentProps<'div'>

function ContextContentBody({ children, className, ...props }: ContextContentBodyProps) {
  return (
    <div
      className={cn('w-full p-3', className)}
      {...props}>
      {children}
    </div>
  )
}

type ContextContentFooterProps = ComponentProps<'div'>

function ContextContentFooter({ children, className, ...props }: ContextContentFooterProps) {
  const { totalCostLabel } = useModelContext()

  return (
    <div
      className={cn(
        'bg-secondary flex w-full items-center justify-between gap-3 p-3 text-xs',
        className
      )}
      {...props}>
      {children ?? (
        <>
          <span className="text-muted-foreground">总成本</span>
          <span>{totalCostLabel ?? '—'}</span>
        </>
      )}
    </div>
  )
}

function TokensRow(props: { label: string; tokens?: number; suffix?: ReactNode }) {
  if (props.tokens === undefined || props.tokens === 0) return null
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{props.label}</span>
      <span>
        {new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(props.tokens)}
        {props.suffix}
      </span>
    </div>
  )
}

type ContextInputUsageProps = ComponentProps<'div'>

function ContextInputUsage({ className, children, ...props }: ContextInputUsageProps) {
  const { usage } = useModelContext()
  if (children) return children
  return (
    <div
      className={cn(className)}
      {...props}>
      <TokensRow
        label="输入"
        tokens={usage?.inputTokens}
      />
    </div>
  )
}

type ContextOutputUsageProps = ComponentProps<'div'>

function ContextOutputUsage({ className, children, ...props }: ContextOutputUsageProps) {
  const { usage } = useModelContext()
  if (children) return children
  return (
    <div
      className={cn(className)}
      {...props}>
      <TokensRow
        label="输出"
        tokens={usage?.outputTokens}
      />
    </div>
  )
}

type ContextReasoningUsageProps = ComponentProps<'div'>

function ContextReasoningUsage({ className, children, ...props }: ContextReasoningUsageProps) {
  const { usage } = useModelContext()
  if (children) return children
  return (
    <div
      className={cn(className)}
      {...props}>
      <TokensRow
        label="推理"
        tokens={usage?.reasoningTokens}
      />
    </div>
  )
}

type ContextCacheUsageProps = ComponentProps<'div'>

function ContextCacheUsage({ className, children, ...props }: ContextCacheUsageProps) {
  const { usage } = useModelContext()
  if (children) return children
  return (
    <div
      className={cn(className)}
      {...props}>
      <TokensRow
        label="缓存"
        tokens={usage?.cachedInputTokens}
      />
    </div>
  )
}

export {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger
}
export type { ContextProps, ModelUsageBreakdown }
