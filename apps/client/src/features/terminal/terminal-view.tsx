/**
 * 单个嵌入终端的 xterm 视图：创建 PTY 会话、接字节流、转发输入与 resize。
 *
 * 所有 tab 的 TerminalView 始终挂载（非 active 仅 invisible），切换不重建会话。
 * 同一 `id` 全局只允许一个视图拥有 PTY，避免多宿主重复 create。
 */
import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { Terminal } from '@/lib/terminal'
import { EVENTS } from '@/shared/ipc/channels'
import { useTerminalStore } from '@/stores/terminal'
import { reportCaught } from '@/utils/exception-report'
import { resolveTerminalTypeface } from './terminal-font'

const textEncoder = new TextEncoder()

/** id → 当前拥有 PTY 的视图 token；后挂载者成为附属，不二次 create */
const SESSION_OWNERS = new Map<string, symbol>()

/** 应用外观以根节点 `.dark` 为唯一来源（见 features/window/appearance.ts）。 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * 把 CSS 变量解析成 canvas 可用的 `rgb()` / `rgba()`。
 * xterm 走 canvas，直接塞 oklch 在部分 WebView 上不稳定。
 */
function resolveCssColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)') return fallback
  return resolved
}

/**
 * 终端主题跟随设计 token（`--background` / `--foreground` 等）。
 * 浅色下压低 white / brightWhite，避免 PSReadLine 幽灵补全在白底上看不见。
 */
function resolveTerminalTheme(): ITheme {
  const isDark = isDarkMode()
  const background = resolveCssColor('--background', isDark ? '#0d1117' : '#ffffff')
  const foreground = resolveCssColor('--foreground', isDark ? '#d4d4d4' : '#1f2328')
  const muted = resolveCssColor('--muted-foreground', isDark ? '#8b949e' : '#656d76')
  const primary = resolveCssColor('--primary', isDark ? '#3b8eea' : '#0451a5')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: isDark
      ? 'rgba(56, 139, 253, 0.35)'
      : 'rgba(9, 105, 218, 0.25)',
    selectionForeground: foreground,
    black: isDark ? '#484f58' : '#24292f',
    red: isDark ? '#ff7b72' : '#cf222e',
    green: isDark ? '#3fb950' : '#116329',
    yellow: isDark ? '#d29922' : '#4d2d00',
    blue: primary,
    magenta: isDark ? '#bc8cff' : '#8250df',
    cyan: isDark ? '#39c5cf' : '#116329',
    white: isDark ? '#b1bac4' : muted,
    brightBlack: muted,
    brightRed: isDark ? '#ffa198' : '#a40e26',
    brightGreen: isDark ? '#56d364' : '#1a7f37',
    brightYellow: isDark ? '#e3b341' : '#633c01',
    brightBlue: primary,
    brightMagenta: isDark ? '#d2a8ff' : '#8250df',
    brightCyan: isDark ? '#56d4dd' : '#0550ae',
    brightWhite: isDark ? '#f0f6fc' : foreground
  }
}

/** 容器尚无布局尺寸时 fit 会量到 0 列，画面空白且无法输入 */
function hasTerminalLayoutSize(container: HTMLElement | null) {
  if (!container) return false
  return container.clientWidth >= 2 && container.clientHeight >= 2
}

/** fit → refresh → 可选聚焦；双 rAF 等布局稳定（父级刚从 display:none 恢复时尤甚） */
function syncTerminalLayout(
  terminal: XtermTerminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  shouldFocus: boolean
) {
  if (!terminal || !fit) return false
  if (!hasTerminalLayoutSize(container)) return false
  try {
    fit.fit()
    if (terminal.cols < 2 || terminal.rows < 1) return false
    terminal.refresh(0, terminal.rows - 1)
    if (shouldFocus) terminal.focus()
    return true
  } catch (error) {
    console.debug('xterm sync 未就绪', error)
    return false
  }
}

/** 尺寸未就绪时连拍几帧再 fit，覆盖 ResizablePanel / hidden→visible 首帧 */
function scheduleTerminalLayout(
  terminal: XtermTerminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  shouldFocus: boolean,
  isCancelled: () => boolean
) {
  let attempts = 0
  function tick() {
    if (isCancelled()) return
    if (syncTerminalLayout(terminal, fit, container, shouldFocus)) return
    attempts += 1
    if (attempts < 12) requestAnimationFrame(tick)
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(tick)
  })
}

interface TerminalViewProps {
  id: string
  cwd: string
  active: boolean
}

function TerminalView(props: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const exitedRef = useRef(false)
  const ownerTokenRef = useRef(Symbol('terminal-view'))
  const isOwnerRef = useRef(false)

  useEffect(
    function () {
      const container = containerRef.current
      if (!container) return

      const token = ownerTokenRef.current
      const existingOwner = SESSION_OWNERS.get(props.id)
      if (existingOwner && existingOwner !== token) {
        // 另一宿主已拥有该会话：本实例只占位，不 create / 不 kill
        isOwnerRef.current = false
        return
      }
      SESSION_OWNERS.set(props.id, token)
      isOwnerRef.current = true

      let disposed = false
      let unlistenExit: (() => void) | null = null

      const themeObserver = new MutationObserver(function () {
        const instance = terminalRef.current
        if (!instance) return
        instance.options.theme = resolveTerminalTheme()
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      })

      void (async function () {
        const typeface = await resolveTerminalTypeface()
        if (disposed) return

        const terminal = new XtermTerminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          cursorInactiveStyle: 'bar',
          fontSize: typeface.fontSize,
          fontFamily: typeface.fontFamily,
          fontWeight: typeface.fontWeight,
          theme: resolveTerminalTheme()
        })
        const fit = new FitAddon()
        terminal.loadAddon(fit)
        terminal.open(container)
        // 字体刚注入时再写一次 family，迫使 canvas 重新量字宽
        terminal.options.fontFamily = typeface.fontFamily
        terminal.options.fontSize = typeface.fontSize
        terminal.options.fontWeight = typeface.fontWeight
        terminalRef.current = terminal
        fitRef.current = fit

        void listen<{ id: string; exitCode: number | null }>(EVENTS.TERMINAL_EXIT, function (event) {
          if (event.payload.id !== props.id || disposed) return
          exitedRef.current = true
          useTerminalStore.getState().markExited(props.id, event.payload.exitCode)
          terminal.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n')
        }).then(function (unlisten) {
          if (disposed) {
            unlisten()
            return
          }
          unlistenExit = unlisten
        })

        try {
          const created = await Terminal.create(props.cwd, props.id, function (data) {
            if (disposed) return
            terminal.write(new Uint8Array(data))
          })
          if (disposed) {
            void Terminal.kill(props.id)
            return
          }
          if (created.pid != null) {
            useTerminalStore.getState().markPid(props.id, created.pid)
          }
          terminal.onData(function (data) {
            if (exitedRef.current) return
            void Terminal.write(props.id, textEncoder.encode(data))
          })
          terminal.onResize(function (size) {
            if (exitedRef.current) return
            void Terminal.resize(props.id, size.rows, size.cols)
          })
          const shouldFocus = useTerminalStore.getState().activeId === props.id
          scheduleTerminalLayout(terminal, fit, container, shouldFocus, function () {
            return disposed
          })
        } catch (error) {
          reportCaught('terminal.create', error)
          terminal.write(
            `\r\n\x1b[91m[终端创建失败：${error instanceof Error ? error.message : String(error)}]\x1b[0m\r\n`
          )
          useTerminalStore.getState().markExited(props.id, null)
        }
      })()

      const observer = new ResizeObserver(function () {
        syncTerminalLayout(terminalRef.current, fitRef.current, container, false)
      })
      observer.observe(container)

      // 父级从 display:none / 折叠恢复时 ResizeObserver 不一定够，可见性变化再 fit
      const visibility = new IntersectionObserver(
        function (entries) {
          const visible = entries.some(function (entry) {
            return entry.isIntersecting && entry.intersectionRatio > 0
          })
          if (!visible) return
          const shouldFocus = useTerminalStore.getState().activeId === props.id
          scheduleTerminalLayout(
            terminalRef.current,
            fitRef.current,
            container,
            shouldFocus,
            function () {
              return disposed
            }
          )
        },
        { threshold: [0, 0.01] }
      )
      visibility.observe(container)

      return function () {
        disposed = true
        observer.disconnect()
        visibility.disconnect()
        themeObserver.disconnect()
        unlistenExit?.()
        const terminalInstance = terminalRef.current
        terminalRef.current = null
        fitRef.current = null
        if (SESSION_OWNERS.get(props.id) === token) {
          SESSION_OWNERS.delete(props.id)
        }
        if (isOwnerRef.current && !exitedRef.current) {
          void Terminal.kill(props.id)
        }
        terminalInstance?.dispose()
        isOwnerRef.current = false
      }
    },
    [props.id, props.cwd]
  )

  useEffect(
    function () {
      if (!props.active) return
      let cancelled = false
      // 双 rAF + 重试：等 CSS 从 invisible / 父级 hidden 恢复后再量尺寸并抢焦点
      scheduleTerminalLayout(
        terminalRef.current,
        fitRef.current,
        containerRef.current,
        true,
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

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-background text-foreground"
      onMouseDown={function () {
        if (props.active) terminalRef.current?.focus()
      }}
    />
  )
}

export { TerminalView }
