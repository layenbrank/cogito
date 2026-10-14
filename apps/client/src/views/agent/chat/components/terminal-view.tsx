/**
 * 单个嵌入终端的 xterm 视图：创建 PTY 会话、接字节流、转发输入与 resize。
 *
 * 所有 tab 的 TerminalView 始终挂载（非 active 仅 CSS 隐藏），切换 tab 不重建会话。
 */
import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { Terminal } from '@/lib/terminal'
import { EVENTS } from '@/shared/ipc/channels'
import { useTerminalStore } from '@/stores/terminal'

const textEncoder = new TextEncoder()

/** 深色 ANSI 16 色（对齐常见 VS Code dark 终端） */
const DARK_THEME: ITheme = {
  background: '#0d1117',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff'
}

/** 浅色 ANSI 16 色（对齐常见 VS Code light 终端） */
const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5'
}

/** 应用外观以根节点 `.dark` 为唯一来源（见 features/window/appearance.ts）。 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
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

  // 会话生命周期：只随 id/cwd 建立一次。先读系统终端字体，再创建 xterm。
  useEffect(
    function () {
      const container = containerRef.current
      if (!container) return

      let disposed = false
      let unlistenExit: (() => void) | null = null
      let themeObserver: MutationObserver | null = null

      // 系统终端字体优先；读不到时回退 Windows 常见终端等宽字体。
      const DEFAULT_FONT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, monospace'

      void (async function () {
        let fontFamily = DEFAULT_FONT_FAMILY
        let fontSize = 12
        try {
          const systemFont = await Terminal.font()
          if (systemFont.family) {
            fontFamily = `"${systemFont.family}", ${DEFAULT_FONT_FAMILY}`
          }
          if (systemFont.size && systemFont.size > 0) fontSize = systemFont.size
        } catch (error) {
          console.warn('[terminal] 读取系统终端字体失败，用默认等宽字体', error)
        }
        if (disposed) return

        const terminal = new XtermTerminal({
          cursorBlink: true,
          fontSize,
          fontFamily,
          theme: isDarkMode() ? DARK_THEME : LIGHT_THEME
        })
        const fit = new FitAddon()
        terminal.loadAddon(fit)
        terminal.open(container)
        terminalRef.current = terminal
        fitRef.current = fit

        // 应用明暗切换时，终端主题随根节点 `.dark` 实时刷新。
        themeObserver = new MutationObserver(function () {
          terminal.options.theme = isDarkMode() ? DARK_THEME : LIGHT_THEME
        })
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class']
        })

        void listen<{ id: string; exitCode: number | null }>(EVENTS.TERMINAL_EXIT, function (event) {
          if (event.payload.id !== props.id || disposed) return
          exitedRef.current = true
          useTerminalStore.getState().markExited(props.id, event.payload.exitCode)
          terminal.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n')
        }).then(function (unlisten) {
          unlistenExit = unlisten
        })

        try {
          await Terminal.create(props.cwd, props.id, function (data) {
            if (disposed) return
            terminal.write(new Uint8Array(data))
          })
          if (disposed) {
            void Terminal.kill(props.id)
            return
          }
          terminal.onData(function (data) {
            if (exitedRef.current) return
            void Terminal.write(props.id, textEncoder.encode(data))
          })
          terminal.onResize(function (size) {
            void Terminal.resize(props.id, size.rows, size.cols)
          })
          try {
            fit.fit()
          } catch (error) {
            console.debug('xterm 初始 fit 未就绪', error)
          }
        } catch (error) {
          console.error('终端创建失败', error)
          terminal.write(
            `\r\n\x1b[91m[终端创建失败：${error instanceof Error ? error.message : String(error)}]\x1b[0m\r\n`
          )
          useTerminalStore.getState().markExited(props.id, null)
        }
      })()

      const observer = new ResizeObserver(function () {
        try {
          fitRef.current?.fit()
        } catch (error) {
          console.debug('xterm fit 未就绪', error)
        }
      })
      observer.observe(container)

      return function () {
        disposed = true
        observer.disconnect()
        themeObserver?.disconnect()
        unlistenExit?.()
        const terminalInstance = terminalRef.current
        terminalRef.current = null
        fitRef.current = null
        if (!exitedRef.current) {
          void Terminal.kill(props.id)
        }
        terminalInstance?.dispose()
      }
    },
    [props.id, props.cwd]
  )

  // 切回 active 时重新 fit，避免 display:none 期间尺寸归零后不自愈。
  useEffect(
    function () {
      if (!props.active) return
      try {
        fitRef.current?.fit()
      } catch (error) {
        console.debug('xterm fit 未就绪', error)
      }
    },
    [props.active]
  )

  return <div ref={containerRef} className="h-full w-full" />
}

export { TerminalView }
