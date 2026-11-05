/**
 * ai-elements 风格的「工具重卡片」（`Tool` / `ToolHeader` / 状态徽章）。
 *
 * **已退出对话流**：对话里的工具卡统一走 `ToolFallback`（assistant-ui 版，一行
 * `Used tool: <label>` + 耗时 + 展开明细），见
 * `apps/client/src/views/agent/chat/components/tool-card-body.tsx`；本轮删减范围与取舍见
 * `docs/apps/client/assistant-ui-elements.md`。带边框 + 状态徽章 + JSON 参数铺开的卡片
 * 只会在一次回答里堆出 6–8 张，是对话区最大的视觉噪音。
 *
 * 本文件保留给**非对话场景**复用（右栏面板、任务面板等），其中 `ToolElapsed` 仍被
 * 命令卡使用。不要在新的对话 UI 里引入 `Tool` / `ToolHeader`。
 */
import { Icon } from '@iconify/react/offline'
import { useToolCallElapsed } from '@assistant-ui/react'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'
import { isValidElement, useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '../components/badge'
import { Button } from '../components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '../components/collapsible'
import { CodeBlock } from './code-block'
import type { ToolCallState } from './tool-call-state'

export type ToolProps = ComponentProps<typeof Collapsible>

/** @deprecated 对话流已改用 assistant-ui `ToolFallback`；仅非对话场景复用。 */
export function Tool({ className, ...props }: ToolProps) {
  return (
    <Collapsible
      className={cn(
        'group not-prose border-border/70 bg-card mb-4 w-full overflow-hidden rounded-lg border shadow-xs',
        className
      )}
      {...props}
    />
  )
}

export type ToolHeaderProps = {
  title?: string
  className?: string
  state: ToolCallState
  toolName?: string
  /** Cursor 式文件改动标注，如 +12 -3 */
  annotation?: ReactNode
}

const STATUS_LABELS: Record<ToolCallState, string> = {
  'approval-requested': '等待审批',
  'approval-responded': '已响应',
  'input-available': '运行中',
  'input-streaming': '等待中',
  'output-available': '已完成',
  'output-denied': '已拒绝',
  'output-error': '出错'
}

function statusIcon(state: ToolCallState): ReactNode {
  switch (state) {
    case 'approval-requested':
      return <Icon icon="lucide:clock" className="text-warning size-3.5" />
    case 'approval-responded':
      return <Icon icon="lucide:circle-check" className="text-primary size-3.5" />
    case 'input-available':
      return <Icon icon="lucide:loader-circle" className="text-primary size-3.5 animate-spin" />
    case 'input-streaming':
      return <Icon icon="lucide:circle" className="text-muted-foreground size-3.5" />
    case 'output-available':
      return <Icon icon="lucide:circle-check" className="text-success size-3.5" />
    case 'output-denied':
      return <Icon icon="lucide:circle-x" className="text-warning size-3.5" />
    case 'output-error':
      return <Icon icon="lucide:circle-x" className="text-destructive size-3.5" />
  }
}

function findStatusBadge(status: ToolCallState) {
  return (
    <Badge
      className="gap-1 rounded-full px-2 py-0 text-xs font-normal"
      variant="secondary">
      {statusIcon(status)}
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function formatElapsedMs(ms: number): string {
  if (ms < 1000) return '<1s'
  const seconds = ms / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.floor(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

/**
 * 工具耗时（墙钟）：读取 part.timing（per-part timing），运行中每秒跳动、
 * 结束后定格；无 timing（如历史恢复的无时序会话）时不渲染。
 */
function ToolElapsed() {
  const elapsedMs = useToolCallElapsed()
  if (elapsedMs === undefined) return null
  return (
    <span
      data-slot="tool-elapsed"
      className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
      {formatElapsedMs(elapsedMs)}
    </span>
  )
}

function ToolHeader({
  className,
  title,
  state,
  toolName,
  annotation,
  ...props
}: ToolHeaderProps) {
  const derivedName = toolName ?? title ?? 'tool'

  return (
    <CollapsibleTrigger
      data-slot="tool-header"
      className={cn(
        'bg-muted/30 flex w-full items-center justify-between gap-3 px-3 py-2',
        'group-data-open:border-border/60 group-data-open:border-b',
        className
      )}
      {...props}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon
          icon="lucide:wrench"
          className="text-primary size-3.5 shrink-0"
        />
        <span className="truncate text-sm font-medium">{title ?? derivedName}</span>
        {annotation ? <span className="shrink-0">{annotation}</span> : null}
        {findStatusBadge(state)}
        <ToolElapsed />
      </div>
      <Icon
        icon="lucide:chevron-down"
        className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-open:rotate-180"
      />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn('space-y-3 p-3 text-sm outline-none', className)}
      {...props}
    />
  )
}

export type ToolInputProps = ComponentProps<'div'> & {
  input: unknown
}

export function ToolInput({ className, input, ...props }: ToolInputProps) {
  return (
    <div
      className={cn('space-y-1.5 overflow-hidden', className)}
      {...props}>
      <h4 className="text-muted-foreground px-0.5 text-xs font-medium tracking-wider uppercase">
        参数
      </h4>
      <div className="border-border/50 bg-muted/40 overflow-hidden rounded-md border">
        <CodeBlock
          code={JSON.stringify(input, null, 2)}
          language="json"
          showHeader={false}
          className="border-0 shadow-none"
          contentClassName="max-h-[min(28vh,14rem)]"
        />
      </div>
    </div>
  )
}

export type ToolOutputProps = ComponentProps<'div'> & {
  output?: unknown
  errorText?: string
}

function shouldRenderOutputBody(output: unknown, errorText: string): boolean {
  if (output === undefined || output === null) return false
  if (typeof output === 'string') return output.trim() !== errorText.trim()
  if (typeof output === 'object' && !isValidElement(output)) {
    try {
      return JSON.stringify(output, null, 2).trim() !== errorText.trim()
    } catch {
      return true
    }
  }
  return true
}

function ToolOutputErrorCopy(props: { text: string }) {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef(0)

  const copyToClipboard = useCallback(async function () {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      console.error('ToolOutput: clipboard API unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(props.text)
      setIsCopied(true)
      timeoutRef.current = window.setTimeout(function () {
        setIsCopied(false)
      }, 2000)
    } catch (error) {
      console.error('ToolOutput: copy failed', error)
    }
  }, [props.text])

  useEffect(
    function clearCopyTimeout() {
      return function () {
        window.clearTimeout(timeoutRef.current)
      }
    },
    []
  )

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-foreground size-7 shrink-0"
      aria-label={isCopied ? '已复制' : '复制错误信息'}
      onClick={copyToClipboard}>
      <Icon
        icon={isCopied ? 'lucide:check' : 'lucide:copy'}
        className="size-3.5 shrink-0"
      />
    </Button>
  )
}

function ToolOutputError(props: { message: string }) {
  return (
    <div
      role="alert"
      className="border-border/50 bg-muted/40 flex items-start gap-2 rounded-md border px-3 py-2.5">
      <Icon
        icon="lucide:circle-alert"
        className="text-destructive mt-0.5 size-3.5 shrink-0"
        aria-hidden
      />
      <p className="text-foreground/90 min-w-0 flex-1 text-xs leading-relaxed whitespace-pre-wrap break-words">
        {props.message}
      </p>
      <ToolOutputErrorCopy text={props.message} />
    </div>
  )
}

function buildToolOutputBody(output: unknown): ReactNode {
  if (output === undefined || output === null) return null

  if (typeof output === 'object' && !isValidElement(output)) {
    return (
      <CodeBlock
        code={JSON.stringify(output, null, 2)}
        language="json"
        showHeader={false}
        className="border-0 shadow-none"
        contentClassName="max-h-[min(40vh,22rem)]"
      />
    )
  }
  if (typeof output === 'string') {
    return (
      <CodeBlock
        code={output}
        language="markdown"
        showHeader={false}
        className="border-0 shadow-none"
        contentClassName="max-h-[min(40vh,22rem)]"
      />
    )
  }
  if (isValidElement(output)) {
    return (
      <div className="max-h-[min(40vh,22rem)] overflow-auto overscroll-y-contain p-2">
        {output}
      </div>
    )
  }

  return <div className="p-2 text-xs">{output as ReactNode}</div>
}

export function ToolOutput({ className, output, errorText, ...props }: ToolOutputProps) {
  if (!(output || errorText)) return null

  const hasExtraOutput = errorText
    ? shouldRenderOutputBody(output, errorText)
    : output !== undefined && output !== null
  const body = hasExtraOutput ? buildToolOutputBody(output) : null

  return (
    <div
      className={cn('space-y-1.5', className)}
      {...props}>
      <h4 className="text-muted-foreground px-0.5 text-xs font-medium tracking-wider uppercase">
        {errorText ? '错误' : '结果'}
      </h4>
      {errorText ? <ToolOutputError message={errorText} /> : null}
      {body ? (
        <div className="border-border/50 bg-muted/40 text-foreground overflow-hidden rounded-md border text-xs">
          {body}
        </div>
      ) : null}
    </div>
  )
}

export { findStatusBadge, formatElapsedMs as formatToolElapsed, ToolElapsed, ToolHeader }
