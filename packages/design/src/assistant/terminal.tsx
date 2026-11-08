import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import Ansi from 'ansi-to-react'
import type { ComponentProps, ComponentType, HTMLAttributes, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '../components/button'

type AnsiProps = { children?: string; className?: string; useClasses?: boolean }
type AnsiComponent = ComponentType<AnsiProps>

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/ // eslint-disable-line no-control-regex
const ERROR_LINE = /\b(error|err!|failed|fatal|exception|traceback)\b/i
const WARN_LINE = /\b(warn(?:ing)?|deprecated)\b/i
const DIR_LINE = /[/\\]$/
const SIZE_MARK = /(\[[0-9.]+\s*[KMG]?B?\]|\[\d+\])/g
/** docker compose / build 右侧耗时列 */
const TIMING_TAIL = /^(.*?)(\s+)(\d+(?:\.\d+)?s)\s*$/
const PLACEHOLDER_LINE = /^(执行中…|没有任何输出|无输出)$/
const STATUS_WORD =
  /\b(Built|Healthy|Running|Started|Exited|Created|Restarting|Paused|Dead|Success|OK)\b/g
const CHECK_MARK = /(✓|✔|√)/g

/** 正文区默认限高：略抬高，接近真实终端可读窗口 */
const TERMINAL_BODY_MAX = 'max-h-[min(36vh,22rem)]'

/** CJS `exports.default` 经 Vite ESM 互通时可能是 `{ default: Fn }` */
function resolveAnsi(): AnsiComponent {
  const candidate = Ansi as unknown as AnsiComponent | { default: AnsiComponent }
  if (typeof candidate === 'function') return candidate
  if (candidate && typeof candidate.default === 'function') return candidate.default
  console.warn('[assistant/terminal] ansi-to-react 导出异常，回退纯文本')
  return function PlainAnsi(props: AnsiProps) {
    return <span className={props.className}>{props.children}</span>
  }
}

const AnsiToReact = resolveAnsi()

interface TerminalContextType {
  output: string
  isStreaming: boolean
  autoScroll: boolean
  cwd?: string | null
  onClear?: () => void
}

const TerminalContext = createContext<TerminalContextType>({
  autoScroll: true,
  isStreaming: false,
  output: ''
})

function shortenCwd(cwd: string): string {
  const trimmed = cwd.trim().replace(/\\/g, '/')
  if (!trimmed) return cwd
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length <= 2) return trimmed
  return parts.slice(-2).join('/')
}

function paintStatusWords(text: string, keyPrefix: string): ReactNode {
  STATUS_WORD.lastIndex = 0
  if (!STATUS_WORD.test(text)) {
    return paintCheckMarks(text, keyPrefix)
  }
  STATUS_WORD.lastIndex = 0
  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let partKey = 0
  while ((match = STATUS_WORD.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(
        <span key={`${keyPrefix}-t-${partKey}`}>
          {paintCheckMarks(text.slice(last, match.index), `${keyPrefix}-${partKey}`)}
        </span>
      )
      partKey += 1
    }
    const word = match[0]
    const tone =
      word === 'Exited' || word === 'Dead' || word === 'Paused'
        ? 'text-terminal-warning'
        : word === 'Restarting'
          ? 'text-terminal-info'
          : 'text-terminal-accent'
    parts.push(
      <span
        key={`${keyPrefix}-s-${partKey}`}
        className={tone}>
        {word}
      </span>
    )
    partKey += 1
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push(
      <span key={`${keyPrefix}-t-${partKey}`}>
        {paintCheckMarks(text.slice(last), `${keyPrefix}-tail`)}
      </span>
    )
  }
  return parts
}

function paintCheckMarks(text: string, keyPrefix: string): ReactNode {
  CHECK_MARK.lastIndex = 0
  if (!CHECK_MARK.test(text)) return text
  CHECK_MARK.lastIndex = 0
  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let partKey = 0
  while ((match = CHECK_MARK.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={`${keyPrefix}-c-${partKey}`}>{text.slice(last, match.index)}</span>)
      partKey += 1
    }
    parts.push(
      <span
        key={`${keyPrefix}-m-${partKey}`}
        className="text-terminal-accent">
        {match[0]}
      </span>
    )
    partKey += 1
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push(<span key={`${keyPrefix}-c-${partKey}`}>{text.slice(last)}</span>)
  }
  return parts
}

function paintSizeMarks(line: string): ReactNode {
  SIZE_MARK.lastIndex = 0
  if (!SIZE_MARK.test(line)) {
    return <span className="text-terminal-foreground">{paintStatusWords(line, 'body')}</span>
  }
  SIZE_MARK.lastIndex = 0
  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let partKey = 0
  while ((match = SIZE_MARK.exec(line)) !== null) {
    if (match.index > last) {
      parts.push(
        <span key={`t-${partKey}`}>
          {paintStatusWords(line.slice(last, match.index), `sz-${partKey}`)}
        </span>
      )
      partKey += 1
    }
    parts.push(
      <span
        key={`s-${partKey}`}
        className="text-terminal-info">
        {match[0]}
      </span>
    )
    partKey += 1
    last = match.index + match[0].length
  }
  if (last < line.length) {
    parts.push(<span key={`t-${partKey}`}>{paintStatusWords(line.slice(last), 'sz-tail')}</span>)
  }
  return <span className="text-terminal-foreground">{parts}</span>
}

function decoratePromptLine(command: string, cwd: string | null | undefined): ReactNode {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="inline-flex min-w-0 items-baseline gap-x-1.5">
        <span className="text-terminal-accent shrink-0 font-bold select-none">$</span>
        <span className="text-terminal-foreground font-medium tracking-tight">{command}</span>
      </span>
      {cwd ? (
        <span className="text-terminal-muted/80 shrink-0 tracking-tight">{shortenCwd(cwd)}</span>
      ) : null}
    </span>
  )
}

function decoratePlainLine(line: string, cwd: string | null | undefined): ReactNode {
  if (line.startsWith('$ ')) {
    return decoratePromptLine(line.slice(2), cwd)
  }

  if (PLACEHOLDER_LINE.test(line)) {
    return <span className="text-terminal-muted">{line}</span>
  }

  if (ERROR_LINE.test(line)) {
    return <span className="text-terminal-danger">{line}</span>
  }
  if (WARN_LINE.test(line)) {
    return <span className="text-terminal-warning">{line}</span>
  }
  if (DIR_LINE.test(line.trimEnd()) || /\/\s*$/.test(line) || line.trimEnd().endsWith('\\')) {
    return <span className="text-terminal-info">{line}</span>
  }

  const timing = TIMING_TAIL.exec(line)
  if (timing) {
    const head = timing[1] ?? ''
    const duration = timing[3] ?? ''
    return (
      <span className="flex min-w-0 items-baseline justify-between gap-4">
        <span className="min-w-0 flex-1">{paintSizeMarks(head)}</span>
        <span className="text-terminal-muted/80 shrink-0 tabular-nums tracking-tight">
          {duration}
        </span>
      </span>
    )
  }

  return paintSizeMarks(line)
}

/** 线状光标（竖条），样式见 globals `[data-slot=terminal-cursor]` */
function TerminalCursor() {
  return (
    <span
      aria-hidden
      data-slot="terminal-cursor"
    />
  )
}

function TerminalOutputBody(props: {
  output: string
  isStreaming: boolean
  cwd: string | null | undefined
}) {
  const hasAnsi = ANSI_ESCAPE.test(props.output)
  const lines = useMemo(
    function () {
      return props.output.split('\n')
    },
    [props.output]
  )

  if (hasAnsi) {
    return (
      <pre className="text-terminal-foreground m-0 whitespace-pre-wrap break-words">
        <AnsiToReact useClasses>{props.output}</AnsiToReact>
        {props.isStreaming ? <TerminalCursor /> : null}
      </pre>
    )
  }

  return (
    <pre className="m-0 whitespace-pre-wrap break-words">
      {lines.map(function (line, index) {
        const isPrompt = index === 0 && line.startsWith('$ ')
        return (
          <div
            key={index}
            className={cn(isPrompt && 'mb-0.5')}>
            {line.length === 0 ? '\u00a0' : decoratePlainLine(line, isPrompt ? props.cwd : null)}
          </div>
        )
      })}
      {props.isStreaming ? <TerminalCursor /> : null}
    </pre>
  )
}

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>

export function TerminalHeader({ className, children, ...props }: TerminalHeaderProps) {
  return (
    <div
      data-slot="terminal-header"
      className={cn(
        'border-terminal-border/70 bg-terminal-surface flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

export type TerminalTitleProps = HTMLAttributes<HTMLDivElement>

export function TerminalTitle({ className, children, ...props }: TerminalTitleProps) {
  return (
    <div
      data-slot="terminal-title"
      className={cn(
        'text-terminal-muted flex min-w-0 items-center gap-1.5 text-xs tracking-tight',
        className
      )}
      {...props}>
      <Icon
        icon="lucide:terminal"
        className="text-terminal-accent size-3 shrink-0 opacity-90"
      />
      <span className="text-terminal-foreground/85 min-w-0 truncate">{children ?? 'Terminal'}</span>
    </div>
  )
}

export type TerminalStatusProps = HTMLAttributes<HTMLDivElement>

export function TerminalStatus({ className, children, ...props }: TerminalStatusProps) {
  const { isStreaming } = useContext(TerminalContext)
  if (!isStreaming) return null
  return (
    <div
      className={cn(
        'text-terminal-accent flex items-center gap-1.5 text-xs tracking-wide uppercase',
        className
      )}
      {...props}>
      {children ?? (
        <>
          <Icon
            icon="lucide:loader-circle"
            className="size-3 animate-spin"
          />
          运行中
        </>
      )}
    </div>
  )
}

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>

export function TerminalActions({ className, children, ...props }: TerminalActionsProps) {
  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      {...props}>
      {children}
    </div>
  )
}

export type TerminalCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
  /** 折叠态没有 Terminal 上下文时直接给出要复制的正文；省略则取上下文里的 output */
  text?: string
}

export function TerminalCopyButton({
  onCopy,
  onError,
  timeout = 2000,
  text,
  children,
  className,
  ...props
}: TerminalCopyButtonProps) {
  const [isCopied, updateCopied] = useState(false)
  const timeoutRef = useRef(0)
  const { output } = useContext(TerminalContext)
  const payload = text ?? output

  const copyToClipboard = useCallback(
    async function () {
      if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
        onError?.(new Error('Clipboard API not available'))
        return
      }
      try {
        await navigator.clipboard.writeText(payload)
        updateCopied(true)
        onCopy?.()
        timeoutRef.current = window.setTimeout(function () {
          updateCopied(false)
        }, timeout)
      } catch (error) {
        onError?.(error as Error)
      }
    },
    [payload, onCopy, onError, timeout]
  )

  useEffect(function () {
    return function () {
      window.clearTimeout(timeoutRef.current)
    }
  }, [])

  return (
    <Button
      className={cn(
        'text-terminal-muted hover:bg-terminal/80 hover:text-terminal-foreground size-6 shrink-0',
        className
      )}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}>
      {children ?? (
        <Icon
          icon={isCopied ? 'lucide:check' : 'lucide:copy'}
          className="size-3"
        />
      )}
    </Button>
  )
}

export type TerminalClearButtonProps = ComponentProps<typeof Button>

export function TerminalClearButton({ children, className, ...props }: TerminalClearButtonProps) {
  const { onClear } = useContext(TerminalContext)
  if (!onClear) return null
  return (
    <Button
      className={cn(
        'text-terminal-muted hover:bg-terminal/80 hover:text-terminal-foreground size-6 shrink-0',
        className
      )}
      onClick={onClear}
      size="icon"
      variant="ghost"
      {...props}>
      {children ?? (
        <Icon
          icon="lucide:trash-2"
          className="size-3"
        />
      )}
    </Button>
  )
}

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>

export function TerminalContent({ className, children, ...props }: TerminalContentProps) {
  const { output, isStreaming, autoScroll, cwd } = useContext(TerminalContext)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(
    function () {
      if (!autoScroll || !containerRef.current) return
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    },
    [output, autoScroll]
  )

  return (
    <div
      data-slot="terminal-content"
      ref={containerRef}
      className={cn(
        'bg-terminal text-terminal-foreground min-h-14 overflow-y-auto overscroll-y-contain',
        'px-3.5 py-2.5 text-xs leading-snug tracking-tight',
        TERMINAL_BODY_MAX,
        className
      )}
      {...props}>
      {children ?? (
        <TerminalOutputBody
          output={output || ''}
          isStreaming={isStreaming}
          cwd={cwd}
        />
      )}
    </div>
  )
}

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
  output: string
  isStreaming?: boolean
  autoScroll?: boolean
  /** 提示符旁可选 cwd 后缀（短路径），不重复塞进标题 */
  cwd?: string | null
  onClear?: () => void
  /** 外层已自带标题条（如折叠摘要行）时关掉内置 header，避免两行标题 */
  showHeader?: boolean
}

export function Terminal({
  output,
  isStreaming = false,
  autoScroll = true,
  cwd,
  onClear,
  showHeader = true,
  className,
  children,
  ...props
}: TerminalProps) {
  const contextValue = useMemo(
    function () {
      return { autoScroll, cwd, isStreaming, onClear, output }
    },
    [autoScroll, cwd, isStreaming, onClear, output]
  )

  return (
    <TerminalContext.Provider value={contextValue}>
      <div
        data-slot="terminal"
        data-streaming={isStreaming || undefined}
        className={cn(
          'bg-terminal text-terminal-foreground border-terminal-border/70 flex flex-col overflow-hidden rounded-md border',
          'shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]',
          'data-[streaming]:border-terminal-accent/40',
          className
        )}
        {...props}>
        {children ?? (
          <>
            {showHeader ? (
              <TerminalHeader>
                <TerminalTitle />
                <div className="flex items-center gap-1">
                  <TerminalStatus />
                  <TerminalActions>
                    <TerminalCopyButton />
                    {onClear ? <TerminalClearButton /> : null}
                  </TerminalActions>
                </div>
              </TerminalHeader>
            ) : null}
            <TerminalContent />
          </>
        )}
      </div>
    </TerminalContext.Provider>
  )
}
