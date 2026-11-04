/**
 * 知识库工具页共用视觉壳：页头、空态、统计胶囊、列表行。
 * 质感对齐 agent：扁平行、轻边框、无多余 ring。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ReactNode } from 'react'

function ToolPageHeader(props: {
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className="mb-4 flex shrink-0 flex-wrap items-end gap-3 border-b border-border/80 pb-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-foreground text-lg leading-snug font-semibold tracking-tight">
            {props.title}
          </h1>
          {props.meta ? <div className="flex flex-wrap items-center gap-1.5">{props.meta}</div> : null}
        </div>
        {props.description ? (
          <p className="text-muted-foreground mt-1.5 max-w-[44em] text-[13px] leading-6">
            {props.description}
          </p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pb-0.5">
          {props.actions}
        </div>
      ) : null}
    </header>
  )
}

function ToolEmpty(props: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="text-muted-foreground flex min-h-32 flex-1 flex-col items-center justify-center gap-2.5 px-4 py-10 text-center">
      {props.icon ? (
        <span className="bg-primary/10 text-primary mb-0.5 flex size-10 items-center justify-center rounded-lg">
          <Icon
            icon={props.icon}
            className="size-4"
          />
        </span>
      ) : null}
      <p className="text-foreground text-sm font-medium">{props.title}</p>
      {props.description ? (
        <p className="text-muted-foreground max-w-sm text-[13px] leading-6">{props.description}</p>
      ) : null}
      {props.action ? <div className="mt-1.5">{props.action}</div> : null}
    </div>
  )
}

function ToolStatPill(props: {
  label: string
  value: string | number
  tone?: 'default' | 'accent' | 'warn' | 'danger' | 'ok'
}) {
  const tone = props.tone ?? 'default'
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs tabular-nums',
        tone === 'default' && 'border-border bg-background/60 text-muted-foreground',
        tone === 'accent' && 'border-primary/25 bg-primary/10 text-primary',
        tone === 'warn' &&
          'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400',
        tone === 'danger' && 'border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'ok' &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400'
      )}>
      {props.label ? <span className="opacity-80">{props.label}</span> : null}
      <span className="text-foreground font-semibold">{props.value}</span>
    </span>
  )
}

/** 列表卡内 kind / 状态等短标签，高度对齐 ToolStatPill。 */
function ToolTag(props: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'bg-muted text-foreground inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium',
        props.className
      )}>
      {props.children}
    </span>
  )
}

function ToolListCard(props: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  const interactive = Boolean(props.onClick)
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        'rounded-lg border border-border/70 bg-card px-3.5 py-3 text-sm',
        'transition-colors duration-150',
        interactive &&
          'hover:bg-muted/40 focus-visible:ring-ring cursor-pointer focus-visible:ring-1 focus-visible:outline-none',
        props.className
      )}
      onClick={props.onClick}
      onKeyDown={
        interactive
          ? function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                props.onClick?.()
              }
            }
          : undefined
      }>
      {props.children}
    </div>
  )
}

function ToolToolbar(props: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex shrink-0 flex-wrap items-center gap-1.5', props.className)}>
      {props.children}
    </div>
  )
}

const TOOL_SHELL =
  'flex min-h-0 flex-1 flex-col bg-[radial-gradient(120%_70%_at_50%_-12%,color-mix(in_oklab,var(--muted)_55%,transparent),transparent_58%),var(--background)] px-5 py-4'
const TOOL_STACK = 'flex min-h-0 flex-1 flex-col gap-0'

export {
  TOOL_SHELL,
  TOOL_STACK,
  ToolEmpty,
  ToolListCard,
  ToolPageHeader,
  ToolStatPill,
  ToolTag,
  ToolToolbar
}
