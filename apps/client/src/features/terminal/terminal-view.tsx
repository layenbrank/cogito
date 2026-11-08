/**
 * 单个嵌入终端的 xterm 视图：创建 / 接上 PTY 会话、接字节流、转发输入与 resize。
 *
 * 由 TerminalTabs 常驻挂载（最近 N 个 tab 保活，非 active 只改透明度）：
 * 会话生命周期不跟随视图卸载，只有显式关闭（× / 结束全部会话）才 kill PTY。
 *
 * **同一 `id` 允许多个宿主同时显示**（右栏终端 + 底部 Dock / 代码页面板）：
 * Rust 侧 `terminal:attach` 经返回值 `replay` 回放缓冲，并扇出实时 Channel，所以后挂的
 * 视图**必须 attach**，而不是像早期那样「只占位不渲染」—— 那会在另一处已经打开同一个
 * tab 时渲染出**一片空白**。只有第一个视图负责 `create`（同 id 已存在时 Rust 只 attach，
 * 不会 silent kill）。
 *
 * 出壳顺序（见 plan 步骤 1）：**同步**用兜底字型 `new Terminal()` + `open()`，
 * 字体链在后台跑并在就绪后原地升级 options —— 绝不在 open 之前 await 字体。
 */
import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { Terminal } from '@/lib/terminal'
import { EVENTS } from '@/shared/ipc/channels'
import { useTerminalStore } from '@/stores/terminal'
import type { TerminalTabOrigin } from '@/stores/terminal'
import { reportCaught } from '@/utils/exception-report'
import {
  resolveTerminalFallbackTypeface,
  resolveTerminalTypeface,
  type TerminalTypeface
} from './terminal-font'
import { canTakeFocus } from './terminal-focus'
import { scheduleTerminalLayout, syncTerminalLayout } from './terminal-layout'
import { resolveTerminalTheme } from './terminal-theme'
import { createWriteQueue } from './terminal-write-queue'

const textEncoder = new TextEncoder()

/** id → 当前负责 `create` 的视图 token；其余视图一律 attach */
const SESSION_OWNERS = new Map<string, symbol>()
/** id → 正在显示的视图数；归零才回收会话 */
const VIEW_COUNTS = new Map<string, number>()

function retainView(id: string): number {
  const next = (VIEW_COUNTS.get(id) ?? 0) + 1
  VIEW_COUNTS.set(id, next)
  return next
}

function releaseView(id: string): number {
  const next = Math.max(0, (VIEW_COUNTS.get(id) ?? 1) - 1)
  if (next === 0) VIEW_COUNTS.delete(id)
  else VIEW_COUNTS.set(id, next)
  return next
}

function delay(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, ms)
  })
}

/**
 * 等主视图把会话建出来再 attach。
 *
 * 两个宿主同时挂载时没有顺序保证：后挂的那个可能比 `create` 早几十毫秒，
 * attach 会拿到「会话不存在」。这里重试到会话出现为止（约 2.4s），
 * 而不是直接判定失败 —— 那正是「终端有时一片空白」的来源。
 */
async function attachWhenReady(
  id: string,
  onOutput: (data: Uint8Array) => void,
  isCancelled: () => boolean
): Promise<Awaited<ReturnType<typeof Terminal.attach>>> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (isCancelled()) throw new Error('视图已卸载')
    try {
      return await Terminal.attach(id, onOutput)
    } catch (error) {
      lastError = error
      console.debug('[terminal] attach 未就绪，重试:', id, error)
      await delay(100)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('接上终端会话失败')
}

interface TerminalViewProps {
  id: string
  cwd: string
  active: boolean
  /** `agent` 的会话已在 Rust 侧建好，视图只需 attach（回放 + 实时流） */
  origin: TerminalTabOrigin
  /**
   * 从 Rust `terminal:list` 灌回来的会话：已经在跑，先 attach；
   * attach 失败（会话早退了）才回退 create，避免每次刷新都把 shell 重启一遍。
   */
  restored?: boolean
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
  /**
   * `restored` 只决定「首次挂载要不要先 attach」，**不能进 effect 依赖**：
   * 后台同步（`bootstrapTerminalSessions`）会把已经在跑的 tab 标成 `restored`，
   * 依赖一变整个 effect 重跑 —— 旧视图卸载、引用计数归零、`Terminal.kill` 把
   * 用户正在用的 shell 杀掉，新视图再 `create` 一个新 shell。
   * 表现出来就是「终端时不时空白/重启」。用 ref 读，不触发重挂。
   */
  const restoredRef = useRef(props.restored === true)
  restoredRef.current = restoredRef.current || props.restored === true
  /** 同上：`active` 也不进主 effect 依赖，否则切 tab 会重挂整个 xterm */
  const activeRef = useRef(props.active)
  activeRef.current = props.active

  useEffect(
    function () {
      const container = containerRef.current
      if (!container) return

      // 第一个挂载的视图负责 create；其余只 attach（Rust 端支持多订阅者扇出）
      const isOwner = !SESSION_OWNERS.has(props.id)
      if (isOwner) SESSION_OWNERS.set(props.id, ownerToken)
      isOwnerRef.current = isOwner
      retainView(props.id)
      exitedRef.current = false

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

      /*
       * ── 出壳：同步创建 + open（兜底字型）──
       * 这里**不允许**出现 await：只要 open 之前有任何一次挂起，
       * 容器就是白的，而且没有重试机会（用户报的「终端空白」）。
       */
      const initialTypeface = resolveTerminalFallbackTypeface()
      const terminal = new XtermTerminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorInactiveStyle: 'bar',
        fontSize: initialTypeface.fontSize,
        fontFamily: initialTypeface.fontFamily,
        fontWeight: initialTypeface.fontWeight,
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
      terminalRef.current = terminal
      fitRef.current = fit
      /*
       * 所有写入（回放 / 实时字节 / 系统行）都走同一条有序队列：
       * 按帧合并 → 串行 `write(bytes, cb)` → 回放与实时不再交错。
       */
      const outputQueue = createWriteQueue(terminal)

      /**
       * 唯一的程序化聚焦入口。
       *
       * 只有「本 tab 可见 + 窗口在前台 + 用户没在别处打字」才真正 focus()：
       * agent 后台跑命令会把 tab 变 active，这里若无条件聚焦就等于替用户抢光标。
       */
      function focusIfAllowed() {
        if (disposed || !activeRef.current) return
        if (!canTakeFocus(container)) return
        terminalRef.current?.focus()
      }

      /** 原地升级字型：options 变了不用重建实例，重新量宽 + 重绘即可 */
      function applyTypeface(typeface: TerminalTypeface) {
        if (disposed) return
        const instance = terminalRef.current
        if (!instance) return
        if (
          instance.options.fontFamily === typeface.fontFamily &&
          instance.options.fontSize === typeface.fontSize &&
          instance.options.fontWeight === typeface.fontWeight
        ) {
          return
        }
        instance.options.fontFamily = typeface.fontFamily
        instance.options.fontSize = typeface.fontSize
        instance.options.fontWeight = typeface.fontWeight
        // 字宽变了：重新 fit 一次，否则光标位置与实际字形错位
        syncTerminalLayout(instance, fitRef.current, container, false)
      }

      void resolveTerminalTypeface({ onLate: applyTypeface }).then(function (typeface) {
        applyTypeface(typeface)
        if (typeface.isFinal) return
        // 超时兜底：onLate 会在真实字型就绪时补一次，这里只留个可排查的日志
        console.info('[terminal] 已用兜底字型出壳，字体就绪后自动升级', props.id)
      })

      void (async function () {
        if (disposed) return

        void listen<{ id: string; exitCode: number | null }>(EVENTS.TERMINAL_EXIT, function (event) {
          if (event.payload.id !== props.id || disposed) return
          exitedRef.current = true
          useTerminalStore.getState().markExited(props.id, event.payload.exitCode)
          outputQueue.pushText('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n')
        }).then(function (unlisten) {
          if (disposed) {
            unlisten()
            return
          }
          unlistenExit = unlisten
        })

        const onOutput = function (data: Uint8Array) {
          if (disposed) return
          // 字节直写：不转字符串，xterm 的有状态 UTF-8 解码器负责跨 chunk 边界
          outputQueue.push(data)
        }
        // agent 会话与「刷新后灌回」的会话都已经存在：先 attach，别重建
        const preferAttach = props.origin === 'agent' || restoredRef.current

        try {
          let created
          if (!isOwner) {
            created = await attachWhenReady(props.id, onOutput, function () {
              return disposed
            })
          } else if (preferAttach) {
            try {
              created = await Terminal.attach(props.id, onOutput)
            } catch (attachError) {
              // 先确认 Hub 里是否还在：IPC 抖动时误 create 会杀长跑（即使 Rust 已禁 silent kill）
              console.warn('[terminal] attach 失败，核对 list 后再决定:', props.id, attachError)
              let stillAlive = false
              try {
                const listed = await Terminal.list()
                stillAlive = listed.some(function (session) {
                  return session.id === props.id
                })
              } catch (listError) {
                console.warn('[terminal] list 核对失败:', listError)
              }
              if (stillAlive) {
                created = await attachWhenReady(props.id, onOutput, function () {
                  return disposed
                })
              } else {
                created = await Terminal.create(props.cwd, props.id, onOutput)
              }
            }
          } else {
            created = await Terminal.create(props.cwd, props.id, onOutput)
          }
          if (disposed) {
            // attach 的场景会话归 agent / 其他宿主所有，别把别人的 shell 一起杀掉
            if (!preferAttach && isOwner) void Terminal.kill(props.id)
            return
          }
          if (created.pid !== null && created.pid !== undefined) {
            useTerminalStore.getState().markPid(props.id, created.pid)
          }
          // 回放已经排在队列最前面（早到的实时块跟在它后面）：先把它写出去再滚到底，
          // 否则滚动发生在回放之前，视口会停在顶部空白区
          if (created.replay && created.replay.length > 0) {
            outputQueue.flushNow()
            requestAnimationFrame(function () {
              if (!disposed) terminal.scrollToBottom()
            })
          }
          terminal.onData(function (data) {
            if (exitedRef.current) return
            void Terminal.write(props.id, textEncoder.encode(data)).catch(function (error) {
              console.warn('[terminal] write 失败:', props.id, error)
            })
          })
          terminal.onResize(function (size) {
            if (exitedRef.current) return
            void Terminal.resize(props.id, size.rows, size.cols).catch(function (error) {
              console.warn('[terminal] resize 失败:', props.id, error)
            })
          })
          // 先排版；聚焦交给 focusIfAllowed —— 用户在 composer 打字时不许抢
          scheduleTerminalLayout(terminal, fit, container, false, function () {
            return disposed
          })
          focusIfAllowed()
        } catch (error) {
          reportCaught(isOwner ? 'terminal.create' : 'terminal.attach', error)
          const reason = error instanceof Error ? error.message : String(error)
          outputQueue.pushText(
            `\r\n\x1b[91m[/${
              isOwner
                ? preferAttach
                  ? '终端连接失败（会话可能已退出）'
                  : '终端创建失败'
                : '终端已在别处关闭，点上方「+」重开一个'
            }：${reason}]\x1b[0m\r\n`
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
          scheduleTerminalLayout(
            terminalRef.current,
            fitRef.current,
            container,
            false,
            function () {
              return disposed
            }
          )
        },
        { threshold: [0, 0.01] }
      )
      visibility.observe(container)
      // 可见性恢复后补一次门槛聚焦（用户正打字时会被挡掉）
      focusIfAllowed()

      return function () {
        disposed = true
        observer.disconnect()
        visibility.disconnect()
        themeObserver.disconnect()
        unlistenExit?.()
        const terminalInstance = terminalRef.current
        terminalRef.current = null
        fitRef.current = null
        // 先停队列：紧接着 dispose 实例，排队中的字节没人消费了
        outputQueue.dispose()

        const remaining = releaseView(props.id)
        // owner 卸载就让出槽位，避免僵尸 owner 占坑导致其它视图永远只 attach
        if (isOwner || remaining === 0) SESSION_OWNERS.delete(props.id)
        // 会话的生命周期**只跟随显式关闭**（tab 上的 × / 结束全部会话），
        // 不跟随视图卸载：面板收起、页签切换、窗口重排都会卸载视图，
        // 那里顺手 kill 会把用户正在用的 shell 一起带走。
        terminalInstance?.dispose()
        isOwnerRef.current = false
      }
    },
    [props.id, props.cwd, props.origin, ownerToken]
  )

  useEffect(
    function () {
      if (!props.active) return
      let cancelled = false
      // 双 rAF + 重试：等 CSS 从 invisible / 父级 hidden 恢复后再量尺寸；
      // 聚焦走 canTakeFocus 门槛（agent 掀面板不能把 composer 的光标抢走）
      scheduleTerminalLayout(
        terminalRef.current,
        fitRef.current,
        containerRef.current,
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

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="终端"
      className="h-full w-full bg-background text-foreground"
      onMouseDown={function () {
        if (props.active) terminalRef.current?.focus()
      }}
    />
  )
}

export { TerminalView }
