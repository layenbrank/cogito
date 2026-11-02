/**
 * 嵌入式终端 / 底部 Dock UI 状态（可序列化元数据）。
 *
 * - `pty`：交互会话；`Terminal` / Channel 由 `terminal-view` 持有
 * - 指令执行流式只读回显挂在 Dock「输出」活动页，不再占独立 tab
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'

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

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  open: boolean
  activity: DockActivity
  openPanel: () => void
  closePanel: () => void
  writeActivity: (activity: DockActivity) => void
  /** 打开底部栏并切到指定活动页（默认「运行」） */
  revealDock: (options?: RevealDockOptions) => void

  newTab: (cwd: string, options?: NewTabOptions) => void
  /** agent 开跑：已经有这个会话就复用并切过去，否则新开一个 `agent · 目录` tab */
  revealAgentTab: (input: AgentTabInput) => void
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
    immer(function (set) {
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
  RevealDockOptions,
  TerminalTab,
  TerminalTabKind,
  TerminalTabOrigin
}
