/**
 * 嵌入式终端 / 底部 Dock UI 状态（可序列化元数据）。
 *
 * - `pty`：交互会话；`Terminal` / Channel 由 `terminal-view` 持有
 * - 指令执行流式只读回显挂在 Dock「输出」活动页，不再占独立 tab
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'

import { Terminal } from '@/lib/terminal'

type TerminalTabKind = 'pty'

/** 谁开的 tab：`agent` 的会话由 Rust 先建好、面板后挂（`terminal:attach`） */
type TerminalTabOrigin = 'user' | 'agent'

/** 底部面板活动页（VS Code 风格）；`input` 承载运行 / 试跑的参数表单 */
type DockActivity = 'run' | 'input' | 'history' | 'terminal'

interface TerminalTab {
  id: string
  kind: TerminalTabKind
  origin: TerminalTabOrigin
  title: string
  cwd: string
  pid: number | null
  exited: boolean
  exitCode: number | null
  /** 该 tab 里最近一次由 agent 执行的命令；「详情 · 正在执行」靠它定位 tab */
  command?: string
  /**
   * 从 Rust `terminal:list` 灌回来的会话（WebView 刷新 / 重开面板）：
   * 视图要先 attach 复用那个 shell，而不是 create 把正在跑的命令杀掉。
   */
  restored?: boolean
}

/** agent 开始跑命令时的入参（来自 `terminal://agent-run`） */
interface AgentTabInput {
  id: string
  cwd: string
  command: string
}

interface NewTabOptions {
  /** 是否同时掀开宿主面板；默认 true */
  reveal?: boolean
}

interface RevealDockOptions {
  activity?: DockActivity
}

interface RestoreAgentPanelOptions {
  /**
   * 只在面板没开（或当前 active 已失效）时接管。
   * 后台定时同步调它时必须传 true：否则每次同步都会把用户手动切走的页签抢回来。
   */
  onlyIfHidden?: boolean
}

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  open: boolean
  activity: DockActivity
  openPanel: () => void
  /**
   * 收起面板**不杀会话**：agent 可能正在里面跑命令，用户也可能只是切去看别的页签。
   * 真要把会话一起回收，用 `closeAllSessions`（页头的「结束全部会话」）。
   */
  closePanel: () => void
  /** 结束全部终端会话（kill PTY + 清空 tabs），用于「我不想留后台进程」 */
  closeAllSessions: () => void
  writeActivity: (activity: DockActivity) => void
  /** 打开底部栏并切到指定活动页（默认「运行」） */
  revealDock: (options?: RevealDockOptions) => void

  newTab: (cwd: string, options?: NewTabOptions) => void
  /** agent 开跑：已经有这个会话就复用并切过去，否则新开一个 `agent · 目录` tab */
  revealAgentTab: (input: AgentTabInput) => void
  /**
   * 刷新后从 Rust list 灌回 tab：不掀开面板、不抢 active（已有则补 pid）。
   *
   * **不会把 `exited` 翻回 false**：`terminal:list` 里还留着会话只说明 scrollback
   * 还能回放，进程该退还是退；翻回运行态会让「已退出」标记消失、`restoreAgentPanel`
   * 反复接管一个死会话 —— 这是「终端时不时不能用」的来源之一。
   */
  hydrateSession: (input: {
    id: string
    cwd: string
    pid: number | null
    origin?: TerminalTabOrigin
  }) => void
  /**
   * WebView 重载后：有存活 agent 会话则掀开面板并保证 active（VS Code reconnect）。
   */
  restoreAgentPanel: (options?: RestoreAgentPanelOptions) => void
  removeTab: (id: string) => void
  writeActive: (id: string) => void
  markExited: (id: string, exitCode: number | null) => void
  markPid: (id: string, pid: number | null) => void
}

function makePtyTitle(cwd: string): string {
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? '终端'
}

const useTerminalStore = create<TerminalState>()(
  subscribeWithSelector(
    immer(function (set, get) {
      return {
        tabs: [],
        activeId: null,
        open: false,
        activity: 'run',

        openPanel: function () {
          set(function (state) {
            state.open = true
          })
        },

        closePanel: function () {
          // 只收起：把 kill 放在这里会让「点 X 关面板」顺手杀掉 agent 正在跑的 shell，
          // 用户再打开就是空白/断掉的会话 —— 正是「终端时不时不能用」的来源之一。
          set(function (state) {
            state.open = false
          })
        },

        closeAllSessions: function () {
          const ids = get().tabs.map(function (tab) {
            return tab.id
          })
          for (const id of ids) {
            void Terminal.kill(id).catch(function (error) {
              console.warn('[terminal] closeAllSessions kill 失败:', id, error)
            })
          }
          set(function (state) {
            state.open = false
            state.tabs = []
            state.activeId = null
            state.activity = 'run'
          })
        },

        writeActivity: function (activity) {
          set(function (state) {
            state.activity = activity
            state.open = true
          })
        },

        revealDock: function (options) {
          set(function (state) {
            state.open = true
            state.activity = options?.activity ?? 'run'
          })
        },

        newTab: function (cwd, options) {
          set(function (state) {
            const id = crypto.randomUUID()
            state.tabs.push({
              id,
              kind: 'pty',
              origin: 'user',
              title: makePtyTitle(cwd),
              cwd,
              pid: null,
              exited: false,
              exitCode: null
            })
            state.activeId = id
            state.activity = 'terminal'
            if (options?.reveal !== false) state.open = true
          })
        },

        revealAgentTab: function (input) {
          set(function (state) {
            const existing = state.tabs.find(function (tab) {
              return tab.id === input.id
            })
            if (existing) {
              existing.command = input.command
              existing.exited = false
            } else {
              state.tabs.push({
                id: input.id,
                kind: 'pty',
                origin: 'agent',
                title: `agent · ${makePtyTitle(input.cwd)}`,
                cwd: input.cwd,
                pid: null,
                exited: false,
                exitCode: null,
                command: input.command
              })
            }
            state.activeId = input.id
            state.activity = 'terminal'
            state.open = true
          })
        },

        hydrateSession: function (input) {
          set(function (state) {
            const existing = state.tabs.find(function (tab) {
              return tab.id === input.id
            })
            if (existing) {
              if (input.pid !== null && input.pid !== undefined) existing.pid = input.pid
              existing.restored = true
              // 保留退出态：list 里有它只说明还能 attach 回放，不代表进程活着
              return
            }
            const origin = input.origin ?? (input.id.startsWith('agent:') ? 'agent' : 'user')
            state.tabs.push({
              id: input.id,
              kind: 'pty',
              origin,
              title:
                origin === 'agent'
                  ? `agent · ${makePtyTitle(input.cwd)}`
                  : makePtyTitle(input.cwd),
              cwd: input.cwd,
              pid: input.pid,
              restored: true,
              exited: false,
              exitCode: null
            })
            // activeId 可能指向已经关掉的 tab：失效也要接管，否则一个视图都不 active → 面板空白
            const activeAlive = state.tabs.some(function (tab) {
              return tab.id === state.activeId
            })
            if (!activeAlive) state.activeId = input.id
          })
        },

        restoreAgentPanel: function (options) {
          set(function (state) {
            const agentTab =
              state.tabs.find(function (tab) {
                return tab.origin === 'agent' && !tab.exited
              }) ??
              state.tabs.find(function (tab) {
                return tab.id.startsWith('agent:')
              })
            if (!agentTab) return
            const activeAlive = state.tabs.some(function (tab) {
              return tab.id === state.activeId
            })
            // 后台同步只负责「面板没开 / active 失效」的情况，不抢用户当前页签
            if (options?.onlyIfHidden === true && state.open && activeAlive) return
            state.open = true
            state.activity = 'terminal'
            if (!activeAlive || !state.activeId) {
              state.activeId = agentTab.id
            }
          })
        },

        removeTab: function (id) {
          set(function (state) {
            const index = state.tabs.findIndex(function (item) {
              return item.id === id
            })
            if (index < 0) return
            state.tabs.splice(index, 1)
            if (state.activeId === id) {
              const fallback = state.tabs[Math.min(index, state.tabs.length - 1)]
              state.activeId = fallback?.id ?? null
            }
          })
        },

        writeActive: function (id) {
          set(function (state) {
            state.activeId = id
            state.activity = 'terminal'
          })
        },

        markExited: function (id, exitCode) {
          set(function (state) {
            const tab = state.tabs.find(function (item) {
              return item.id === id
            })
            if (tab) {
              tab.exited = true
              tab.exitCode = exitCode
            }
          })
        },

        markPid: function (id, pid) {
          set(function (state) {
            const tab = state.tabs.find(function (item) {
              return item.id === id
            })
            if (tab) tab.pid = pid
          })
        }
      }
    })
  )
)

export { useTerminalStore }
export type {
  AgentTabInput,
  DockActivity,
  NewTabOptions,
  RestoreAgentPanelOptions,
  RevealDockOptions,
  TerminalTab,
  TerminalTabKind,
  TerminalTabOrigin
}
