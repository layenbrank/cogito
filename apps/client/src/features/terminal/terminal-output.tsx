/**
 * 指令执行流式只读 xterm：按帧游标增量 write `step_output`。
 * 单层宿主即挂载点；不 create PTY。列表与编排台共用。
 */
import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { cn } from 'cn'

import type { CorexFrame } from '@/stores/run-logs.ts'

import { FALLBACK_FONT_FAMILY, resolveTerminalTypeface } from './terminal-font'
import { scheduleTerminalLayout, syncTerminalLayout } from './terminal-layout'
import { resolveTerminalTheme } from './terminal-theme'

const BOTTOM_GAP_ROWS = 2
const ANSI_DIM = '\x1b[90m'
const ANSI_RED = '\x1b[31m'
const ANSI_RESET = '\x1b[0m'

interface TerminalOutputProps {
  runId: string | null
  frames: readonly CorexFrame[]
  error?: string | null
  placeholder?: string
  active: boolean
  className?: string
}

function writePlaceholder(terminal: XtermTerminal, placeholder: string) {
  terminal.reset()
  terminal.write(`${ANSI_DIM}${placeholder}${ANSI_RESET}`)
}

function writeErrorBlock(terminal: XtermTerminal, error: string) {
  terminal.write(
    `${ANSI_DIM}进程未启动，没有 stdout/stderr 可回显。${ANSI_RESET}\r\n` +
      `${ANSI_RED}${error}${ANSI_RESET}\r\n`
  )
}

function findOutputChunk(frame: CorexFrame): string {
  if (frame.kind !== 'step_output') return ''
  return frame.text ?? ''
}

function TerminalOutput(props: TerminalOutputProps) {
  const placeholder = props.placeholder ?? '运行输出将显示在这里…'
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const writtenCountRef = useRef(0)
  const runIdRef = useRef<string | null>(null)
  const showingPlaceholderRef = useRef(true)
  const errorWrittenRef = useRef<string | null>(null)
  const isFollowingRef = useRef(true)
  const placeholderRef = useRef(placeholder)
  const [isReady, setReady] = useState(false)

  placeholderRef.current = placeholder

  useEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      let disposed = false

      const themeObserver = new MutationObserver(function () {
        const instance = terminalRef.current
        if (!instance) return
        instance.options.theme = resolveTerminalTheme()
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      })

      const terminal = new XtermTerminal({
        disableStdin: true,
        convertEol: true,
        cursorBlink: false,
        cursorStyle: 'bar',
        cursorInactiveStyle: 'outline',
        fontSize: 12,
        fontFamily: FALLBACK_FONT_FAMILY,
        theme: resolveTerminalTheme(),
        scrollback: 5_000,
        cols: 80,
        rows: 12
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(host)
      terminalRef.current = terminal
      fitRef.current = fit

      writePlaceholder(terminal, placeholderRef.current)
      showingPlaceholderRef.current = true
      writtenCountRef.current = 0
      runIdRef.current = null
      errorWrittenRef.current = null

      terminal.onScroll(function () {
        const buffer = terminal.buffer.active
        const gap = buffer.baseY + buffer.cursorY - buffer.viewportY - (terminal.rows - 1)
        isFollowingRef.current = gap <= BOTTOM_GAP_ROWS
      })

      scheduleTerminalLayout(terminal, fit, host, false, function () {
        return disposed
      })
      setReady(true)

      void (async function () {
        try {
          const typeface = await resolveTerminalTypeface()
          if (disposed || terminalRef.current !== terminal) return
          terminal.options.fontFamily = typeface.fontFamily
          terminal.options.fontSize = typeface.fontSize
          terminal.options.fontWeight = typeface.fontWeight
          scheduleTerminalLayout(terminal, fit, host, false, function () {
            return disposed
          })
        } catch (error) {
          console.warn('[terminal] 运行输出字体加载失败，沿用兜底等宽', error)
        }
      })()

      const observer = new ResizeObserver(function () {
        syncTerminalLayout(terminalRef.current, fitRef.current, host, false)
      })
      observer.observe(host)

      return function () {
        disposed = true
        setReady(false)
        observer.disconnect()
        themeObserver.disconnect()
        const instance = terminalRef.current
        terminalRef.current = null
        fitRef.current = null
        instance?.dispose()
      }
    },
    []
  )

  useEffect(
    function () {
      if (!props.active) return
      let cancelled = false
      scheduleTerminalLayout(
        terminalRef.current,
        fitRef.current,
        hostRef.current,
        false,
        function () {
          return cancelled
        }
      )
      return function () {
        cancelled = true
      }
    },
    [props.active]
  )

  useEffect(
    function () {
      if (!isReady) return
      const terminal = terminalRef.current
      if (!terminal) return

      const runId = props.runId
      const frames = props.frames
      const runChanged = runIdRef.current !== runId
      const truncated = frames.length < writtenCountRef.current

      if (runChanged || frames.length === 0 || truncated) {
        runIdRef.current = runId
        writtenCountRef.current = 0
        errorWrittenRef.current = null
        if (frames.length === 0 && props.error) {
          terminal.reset()
          showingPlaceholderRef.current = false
          writeErrorBlock(terminal, props.error)
          errorWrittenRef.current = props.error
          return
        }
        writePlaceholder(terminal, placeholder)
        showingPlaceholderRef.current = true
        if (frames.length === 0) return
      }

      const from = writtenCountRef.current
      for (let i = from; i < frames.length; i += 1) {
        const chunk = findOutputChunk(frames[i])
        if (!chunk) continue
        if (showingPlaceholderRef.current) {
          terminal.reset()
          showingPlaceholderRef.current = false
        }
        terminal.write(chunk)
      }
      writtenCountRef.current = frames.length

      if (props.error && errorWrittenRef.current !== props.error) {
        if (showingPlaceholderRef.current) {
          terminal.reset()
          showingPlaceholderRef.current = false
        }
        writeErrorBlock(terminal, props.error)
        errorWrittenRef.current = props.error
      }

      if (isFollowingRef.current) terminal.scrollToBottom()
    },
    [isReady, props.runId, props.frames, props.error, placeholder]
  )

  return (
    <div
      ref={hostRef}
      className={cn(
        'h-full min-h-0 min-w-0 w-full overflow-hidden bg-background',
        '[&_.xterm]:h-full [&_.xterm]:w-full [&_.xterm-viewport]:h-full',
        props.className
      )}
    />
  )
}

export { TerminalOutput }
export type { TerminalOutputProps }
