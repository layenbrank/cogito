/**
 * 嵌入式交互终端 UI 状态（可序列化元数据）。
 *
 * `Terminal` / `Channel` 实例不进 store——由 `terminal-view` 组件用 ref 持有，
 * 组件卸载即随 ref 销毁。这里只存 tab 元数据与面板开关。
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'

interface TerminalTab {
  id: string
  title: string
  cwd: string
  pid: number | null
  exited: boolean
  exitCode: number | null
}

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  open: boolean
  openPanel: () => void
  closePanel: () => void
  newTab: (cwd: string) => void
  removeTab: (id: string) => void
  setActive: (id: string) => void
  markExited: (id: string, exitCode: number | null) => void
}

/** tab 标题取工作区路径末段，便于在标签栏辨识。 */
function makeTerminalTitle(cwd: string): string {
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

        openPanel: function () {
          set(function (state) {
            state.open = true
          })
        },

        closePanel: function () {
          set(function (state) {
            state.open = false
            // 关闭面板 = 结束全部会话并清空 tab（TerminalView 卸载时各自 kill）。
            state.tabs = []
            state.activeId = null
          })
        },

        newTab: function (cwd) {
          set(function (state) {
            const id = crypto.randomUUID()
            state.tabs.push({
              id,
              title: makeTerminalTitle(cwd),
              cwd,
              pid: null,
              exited: false,
              exitCode: null
            })
            state.activeId = id
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

        setActive: function (id) {
          set(function (state) {
            state.activeId = id
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
        }
      }
    })
  )
)

export { useTerminalStore }
export type { TerminalTab }
