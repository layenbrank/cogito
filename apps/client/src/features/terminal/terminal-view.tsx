/**
 * 单个嵌入终端的 xterm 视图：创建 PTY 会话、接字节流、转发输入与 resize。
 *
 * 所有 tab 的 TerminalView 始终挂载（非 active 仅 invisible），切换不重建会话。
 * 同一 `id` 全局只允许一个视图拥有 PTY，避免多宿主重复 create。
 */
import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { Terminal } from '@/lib/terminal'
import { EVENTS } from '@/shared/ipc/channels'
import { useTerminalStore } from '@/stores/terminal'
import { reportCaught } from '@/utils/exception-report'
import { resolveTerminalTypeface } from './terminal-font'
import { scheduleTerminalLayout, syncTerminalLayout } from './terminal-layout'
import { resolveTerminalTheme } from './terminal-theme'

const textEncoder = new TextEncoder()

/** id → 当前拥有 PTY 的视图 token；后挂载者成为附属，不二次 create */
const SESSION_OWNERS = new Map<string, symbol>()

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
  const [ownerToken] = useState(function () {
    return Symbol('terminal-view')
  })
  const isOwnerRef = useRef(false)

  useEffect(
    function () {
      const container = containerRef.current
      if (!container) return

      const existingOwner = SESSION_OWNERS.get(props.id)
      if (existingOwner && existingOwner !== ownerToken) {
        // 另一宿主已拥有该会话：本实例只占位，不 create / 不 kill
        isOwnerRef.current = false
        return
      }
      SESSION_OWNERS.set(props.id, ownerToken)
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
        /*
         * Shift+Enter = 插入换行，而不是提交。
         *
         * 直接发 `\n` 没用 —— bash/zsh 同样会执行命令。这里走 readline 的
         * quoted-insert：`C-v` + `C-j`，把换行当字面字符插进当前行，
         * 于是能写多行命令/粘贴块后再统一回车执行。
         */
        terminal.attachCustomKeyEventHandler(function (event) {
          if (event.type !== 'keydown') return true
          if (event.key !== 'Enter' || !event.shiftKey) return true
          event.preventDefault()
          terminal.input('\x16\x0a', true)
          return false
        })
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
          if (created.pid !== null && created.pid !== undefined) {
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
        if (SESSION_OWNERS.get(props.id) === ownerToken) {
          SESSION_OWNERS.delete(props.id)
        }
        if (isOwnerRef.current && !exitedRef.current) {
          void Terminal.kill(props.id)
        }
        terminalInstance?.dispose()
        isOwnerRef.current = false
      }
    },
    [props.id, props.cwd, ownerToken]
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
      role="group"
      aria-label="终端"
      tabIndex={0}
      className="h-full w-full bg-background text-foreground"
      onMouseDown={function () {
        if (props.active) terminalRef.current?.focus()
      }}
      onKeyDown={function (event) {
        if (!props.active) return
        // 只处理「容器自己拿到焦点」的情况：按键来自 xterm 内部（子元素）时
        // 必须放行，否则空格 / 回车会被 preventDefault 吞掉，终端里打不出空格和换行
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        terminalRef.current?.focus()
      }}
    />
  )
}

export { TerminalView }
