/**
 * 命令与代码的「模拟终端」面板（对齐 studio，无 motion 依赖）。
 *
 * 面板恒为深色：会话区浅色主题下若用浅底会与正文糊在一起。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useState, type ReactNode } from 'react'

import { collapseOutput, TERMINAL_PREVIEW_LINES } from './tool-output'

/** 终端正文可视高度：过程折叠区内也要能扫到足够多行 */
const TERMINAL_BODY_MAX = 'max-h-[min(50vh,28rem)]'

function OutputLines(props: { lines: readonly string[]; keyPrefix: string }) {
  return props.lines.map(function (line, index) {
    return (
      <div
        key={`${props.keyPrefix}-${index}`}
        className="hover:bg-terminal-surface/50 -mx-1 rounded-sm px-1 whitespace-pre-wrap break-all">
        {line.length === 0 ? '\u00a0' : line}
      </div>
    )
  })
}

function TerminalOutput(props: { text: string; maxLines: number }) {
  const [isExpanded, updateExpanded] = useState(false)
  const collapsed = collapseOutput(props.text, props.maxLines)
  const preview = collapsed.lines
  const rest =
    collapsed.hidden > 0
      ? collapseOutput(props.text, Number.MAX_SAFE_INTEGER).lines.slice(props.maxLines)
      : []

  if (preview.length === 0) return null

  return (
    <div className="min-w-0">
      <OutputLines
        lines={preview}
        keyPrefix="preview"
      />
      {isExpanded && rest.length > 0 ? (
        <OutputLines
          lines={rest}
          keyPrefix="rest"
        />
      ) : null}
      {collapsed.hidden > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-terminal-muted hover:bg-terminal-surface hover:text-terminal-foreground mt-1.5 h-6 cursor-pointer px-1.5"
          onClick={function () {
            updateExpanded(!isExpanded)
          }}>
          {isExpanded ? (
            <>
              <Icon
                icon="lucide:chevron-up"
                className="size-3"
              />
              收起
            </>
          ) : (
            <>
              <Icon
                icon="lucide:chevron-down"
                className="size-3"
              />
              展开全部（还有 {collapsed.hidden} 行）
            </>
          )}
        </Button>
      ) : null}
    </div>
  )
}

function Placeholder(props: { text: string }) {
  return <div className="text-terminal-muted py-1 italic">{props.text}</div>
}

interface TerminalShellProps {
  header: ReactNode
  isError: boolean
  isRunning: boolean
  footer?: ReactNode
  children: ReactNode
}

function TerminalShell(props: TerminalShellProps) {
  return (
    <div
      data-slot="agent-tool-terminal"
      data-state={props.isRunning ? 'running' : props.isError ? 'error' : 'done'}
      className={[
        // 终端孤岛：圆角略大，与 Trace 工具行的卡片语言对齐
        'bg-terminal text-terminal-foreground overflow-hidden rounded-xl border',
        'border-terminal-border shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]',
        'data-[state=error]:border-terminal-danger/50',
        'data-[state=running]:border-terminal-accent/35'
      ].join(' ')}>
      <div className="border-terminal-border bg-terminal-surface/55 flex items-center gap-2 border-b px-3 py-1.5">
        <Icon
          icon="lucide:terminal"
          className="text-terminal-muted size-3.5 shrink-0"
        />
        <div className="text-terminal-foreground min-w-0 flex-1 font-mono text-xs leading-snug break-all">
          {props.header}
        </div>
        {props.isRunning ? (
          <Icon
            icon="lucide:loader-circle"
            className="text-terminal-muted size-3.5 shrink-0 animate-spin"
          />
        ) : props.isError ? (
          <Icon
            icon="lucide:x"
            className="text-terminal-danger size-3.5 shrink-0"
          />
        ) : (
          <Icon
            icon="lucide:check"
            className="text-terminal-accent size-3.5 shrink-0"
          />
        )}
      </div>

      <div
        className={[
          'flex min-h-20 flex-col gap-1 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed',
          'selection:bg-terminal-accent/25 selection:text-terminal-foreground',
          '[scrollbar-color:var(--color-terminal-border)_transparent] scrollbar-thin',
          TERMINAL_BODY_MAX
        ].join(' ')}>
        {props.children}
        {props.footer ?? null}
      </div>
    </div>
  )
}

function ToolCommand(props: {
  command: string
  workdir: string | null
  background: boolean
  output: string | null
  isError: boolean
  isRunning: boolean
}) {
  const hasOutput = props.output !== null && collapseOutput(props.output).lines.length > 0
  const empty = props.isRunning ? '执行中…' : props.isError ? '没有任何输出' : '无输出'

  return (
    <TerminalShell
      isError={props.isError}
      isRunning={props.isRunning}
      footer={hasOutput ? null : <Placeholder text={empty} />}
      header={
        <>
          <span className="text-terminal-accent font-semibold">$</span>{' '}
          <span className="text-terminal-foreground">{props.command}</span>
          {props.workdir === null ? null : (
            <span className="text-terminal-muted"> · {props.workdir}</span>
          )}
          {props.background ? <span className="text-terminal-muted"> · 后台</span> : null}
        </>
      }>
      {props.output === null ? null : (
        <TerminalOutput
          text={props.output}
          maxLines={TERMINAL_PREVIEW_LINES}
        />
      )}
    </TerminalShell>
  )
}

function ToolCodeMode(props: {
  source: string
  output: string | null
  isError: boolean
  isRunning: boolean
}) {
  const empty = props.isRunning ? '执行中…' : props.isError ? '执行失败' : '无返回'

  return (
    <TerminalShell
      isError={props.isError}
      isRunning={props.isRunning}
      footer={props.output === null ? <Placeholder text={empty} /> : null}
      header={<span className="text-terminal-muted">Code Mode · JavaScript</span>}>
      <div className="text-terminal-muted/90">
        <TerminalOutput
          text={props.source}
          maxLines={16}
        />
      </div>
      {props.output === null ? null : (
        <div className="border-terminal-border mt-1 border-t pt-2">
          <div className="text-terminal-muted mb-1 text-xs tracking-wide uppercase">
            output
          </div>
          <TerminalOutput
            text={props.output}
            maxLines={TERMINAL_PREVIEW_LINES}
          />
        </div>
      )}
    </TerminalShell>
  )
}

export { ToolCodeMode, ToolCommand }
