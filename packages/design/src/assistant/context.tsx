/**
 * Model context window usage (AI Elements `Context`).
 * Token cost rows are optional — no `tokenlens` / `@ai-sdk/*` dependency.
 */
import { Icon } from '@iconify/react/offline'
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
  /** 请求前估算：系统提示 */
  systemTokens?: number
  /** 请求前估算：历史消息 */
  historyTokens?: number
  /** 请求前估算：工具结果 */
  toolTokens?: number
  /** 请求前估算：附件 */
  attachmentTokens?: number
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
  // 抬升阴影走全局 OVERLAY_SHELL（PopoverContent），此处只补内容分区
  return (
    <PopoverContent
      className={cn('min-w-60 divide-y divide-border/60 overflow-hidden p-0', className)}
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

type ContextSourceUsageProps = ComponentProps<'div'>

/** 来源分段（系统 / 历史 / 工具 / 附件）—— 多为请求前估算 */
function ContextSourceUsage({ className, children, ...props }: ContextSourceUsageProps) {
  const { usage } = useModelContext()
  if (children) return children
  return (
    <div
      className={cn('space-y-1', className)}
      {...props}>
      <TokensRow
        label="系统提示"
        tokens={usage?.systemTokens}
      />
      <TokensRow
        label="历史消息"
        tokens={usage?.historyTokens}
      />
      <TokensRow
        label="工具结果"
        tokens={usage?.toolTokens}
      />
      <TokensRow
        label="附件"
        tokens={usage?.attachmentTokens}
      />
    </div>
  )
}

type ContextBreakdownLevel = 'ok' | 'warn' | 'danger'

interface ContextBreakdownSegment {
  key: string
  label: string
  /** lucide 图标名 */
  icon: string
  /** 分段色条用的 Tailwind 背景类 */
  tone: string
  tokens: number
  /** 占合计的比例 0..1 */
  ratio: number
}

type ContextBreakdownBarProps = ComponentProps<'div'> & {
  segments: readonly ContextBreakdownSegment[]
  /** 占用率档位：ok / warn(≥70%) / danger(≥90%)，阈值判定在业务侧（单一来源） */
  level?: ContextBreakdownLevel
  /** 「查看详情」入口：明细（Top N、提示词原文）放右栏面板，气泡里只留概览 */
  onOpenDetails?: () => void
}

const LEVEL_RING: Record<ContextBreakdownLevel, string> = {
  ok: 'ring-transparent',
  warn: 'ring-amber-500/40',
  danger: 'ring-destructive/50'
}

const LEVEL_TEXT: Record<ContextBreakdownLevel, string> = {
  ok: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive'
}

/** 档位提示：只在真的越线时占一行，平时留空（气泡不做说明书） */
const LEVEL_HINT: Record<ContextBreakdownLevel, string> = {
  ok: '',
  warn: '占用超过 70%',
  danger: '接近上限，建议新建会话'
}

function formatSegmentTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/**
 * 上下文概览：一条色条 + 四行来源。
 *
 * 气泡只回答「大概被什么占了」；逐条消息、提示词原文这类明细在右栏「上下文」面板，
 * 点「查看详情」过去 —— 气泡里铺开 Top N 会盖住半个对话。
 */
function ContextBreakdownBar({
  segments,
  level = 'ok',
  onOpenDetails,
  className,
  ...props
}: ContextBreakdownBarProps) {
  return (
    <div
      data-slot="model-context-breakdown"
      data-level={level}
      className={cn('space-y-2', className)}
      {...props}>
      <div
        className={cn(
          'bg-muted flex h-1.5 w-full overflow-hidden rounded-full ring-1 ring-inset',
          LEVEL_RING[level]
        )}>
        {segments.map(function (segment) {
          if (segment.tokens <= 0) return null
          return (
            <div
              key={segment.key}
              data-segment={segment.key}
              className={cn('h-full transition-[width] duration-300', segment.tone)}
              // 极小的段也留 2% 宽度：不然「有但看不到」比没有更让人困惑
              style={{ width: `${Math.max(2, segment.ratio * 100)}%` }}
              title={`${segment.label} ${formatSegmentTokens(segment.tokens)} · ${Math.round(
                segment.ratio * 100
              )}%`}
            />
          )
        })}
      </div>
      <ul className="space-y-1">
        {segments.map(function (segment) {
          return (
            <li
              key={segment.key}
              data-slot="model-context-legend"
              className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', segment.tone)}
              />
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {segment.label}
              </span>
              <span className="text-foreground/90 shrink-0 font-mono text-xs tabular-nums">
                {formatSegmentTokens(segment.tokens)}
              </span>
              <span className="text-muted-foreground w-9 shrink-0 text-right font-mono text-xs tabular-nums">
                {Math.round(segment.ratio * 100)}%
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-2">
        <span
          className={cn('inline-flex min-w-0 items-center gap-1 text-xs', LEVEL_TEXT[level])}>
          {level === 'ok' ? null : (
            <Icon
              icon="lucide:triangle-alert"
              className="size-3 shrink-0"
              aria-hidden
            />
          )}
          <span className="truncate">{LEVEL_HINT[level]}</span>
        </span>
        {onOpenDetails ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="ms-auto h-5 shrink-0 gap-1 px-0 text-xs"
            onClick={onOpenDetails}>
            查看详情
            <Icon
              icon="lucide:arrow-right"
              className="size-3 shrink-0"
            />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export {
  Context,
  ContextBreakdownBar,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextSourceUsage,
  ContextTrigger
}
export type {
  ContextBreakdownBarProps,
  ContextBreakdownLevel,
  ContextBreakdownSegment,
  ContextProps,
  ModelUsageBreakdown
}
