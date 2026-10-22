/**
 * 代码窗口 workbench 状态：工作区根、多 tab、侧栏/底栏、光标与命令面板。
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools, subscribeWithSelector } from 'zustand/middleware'

import { findLanguageId } from '@/views/code/lib/language.ts'
import { findFileName, isPathInsideRoot, normalizeSeparators } from '@/views/code/lib/path.ts'

type SidebarView = 'explorer' | 'search' | 'scm'
type PanelTab = 'terminal' | 'problems'
type PaletteMode = 'command' | 'file' | null

interface CodeTab {
  id: string
  path: string
  title: string
  language: string
  isDirty: boolean
}

interface CursorPosition {
  line: number
  column: number
}

interface CodeState {
  workspaceRoot: string | null
  tabs: CodeTab[]
  activeTabId: string | null
  sidebarView: SidebarView
  isSidebarOpen: boolean
  isPanelOpen: boolean
  panelTab: PanelTab
  cursor: CursorPosition
  languageId: string
  paletteMode: PaletteMode
  treeRevision: number
  problemCount: number

  toSetWorkspaceRoot: (root: string) => void
  toOpenTab(params: { path: string; language?: string }): void
  toActivateTab: (id: string) => void
  toCloseTab: (id: string) => void
  /** 关闭 path 本身或位于该目录下的所有 tab，返回被关 tab 的 path */
  toCloseByPath: (path: string) => string[]
  /** 文件/目录重命名后迁移打开的 tab 路径 */
  toRelocatePath: (fromPath: string, toPath: string) => void
  toMarkDirty: (id: string, isDirty?: boolean) => void
  toMarkSaved: (id: string) => void
  toSetSidebarView: (view: SidebarView) => void
  toToggleSidebar: () => void
  toToggleSidebarView: (view: SidebarView) => void
  toSetPanelOpen: (isOpen: boolean) => void
  toTogglePanel: (tab?: PanelTab) => void
  toSetPanelTab: (tab: PanelTab) => void
  toSetCursor: (cursor: CursorPosition) => void
  toSetLanguageId: (languageId: string) => void
  toSetPaletteMode: (mode: PaletteMode) => void
  toBumpTree: () => void
  toSetProblemCount: (count: number) => void
}

function isSamePath(a: string, b: string): boolean {
  return normalizeSeparators(a).toLowerCase() === normalizeSeparators(b).toLowerCase()
}

function relocateTabPath(tabPath: string, fromPath: string, toPath: string): string | null {
  if (isSamePath(tabPath, fromPath)) return toPath
  if (!isPathInsideRoot(fromPath, tabPath)) return null
  const fromNorm = normalizeSeparators(fromPath).replace(/\/+$/, '')
  const tabNorm = normalizeSeparators(tabPath)
  const suffix = tabNorm.slice(fromNorm.length)
  return `${normalizeSeparators(toPath).replace(/\/+$/, '')}${suffix}`
}

function findActiveTab(state: CodeState): CodeTab | undefined {
  return state.tabs.find(function (tab) {
    return tab.id === state.activeTabId
  })
}

const useCodeStore = create<CodeState>()(
  devtools(
    subscribeWithSelector(
      immer(function (set) {
        return {
          workspaceRoot: null,
          tabs: [],
          activeTabId: null,
          sidebarView: 'explorer',
          isSidebarOpen: true,
          isPanelOpen: false,
          panelTab: 'terminal',
          cursor: { line: 1, column: 1 },
          languageId: 'plaintext',
          paletteMode: null,
          treeRevision: 0,
          problemCount: 0,

          toSetWorkspaceRoot(root) {
            set(
              function (state) {
                state.workspaceRoot = root
              },
              false,
              'toSetWorkspaceRoot'
            )
          },

          toOpenTab(params) {
            set(
              function (state) {
                const existing = state.tabs.find(function (tab) {
                  return tab.path === params.path
                })
                if (existing) {
                  state.activeTabId = existing.id
                  state.languageId = existing.language
                  return
                }
                const language = params.language ?? findLanguageId(params.path)
                const id = crypto.randomUUID()
                state.tabs.push({
                  id,
                  path: params.path,
                  title: findFileName(params.path),
                  language,
                  isDirty: false
                })
                state.activeTabId = id
                state.languageId = language
              },
              false,
              'toOpenTab'
            )
          },

          toActivateTab(id) {
            set(
              function (state) {
                const tab = state.tabs.find(function (item) {
                  return item.id === id
                })
                if (!tab) return
                state.activeTabId = id
                state.languageId = tab.language
              },
              false,
              'toActivateTab'
            )
          },

          toCloseTab(id) {
            set(
              function (state) {
                const index = state.tabs.findIndex(function (tab) {
                  return tab.id === id
                })
                if (index < 0) return
                state.tabs.splice(index, 1)
                if (state.activeTabId === id) {
                  const fallback = state.tabs[Math.min(index, state.tabs.length - 1)]
                  state.activeTabId = fallback?.id ?? null
                  state.languageId = fallback?.language ?? 'plaintext'
                  if (!fallback) {
                    state.cursor = { line: 1, column: 1 }
                  }
                }
              },
              false,
              'toCloseTab'
            )
          },

          toCloseByPath(path) {
            const closed: string[] = []
            set(
              function (state) {
                const nextTabs: CodeTab[] = []
                let removedActive = false
                for (const tab of state.tabs) {
                  if (isSamePath(tab.path, path) || isPathInsideRoot(path, tab.path)) {
                    closed.push(tab.path)
                    if (tab.id === state.activeTabId) removedActive = true
                    continue
                  }
                  nextTabs.push(tab)
                }
                state.tabs = nextTabs
                if (removedActive) {
                  const fallback = nextTabs[0]
                  state.activeTabId = fallback?.id ?? null
                  state.languageId = fallback?.language ?? 'plaintext'
                  if (!fallback) {
                    state.cursor = { line: 1, column: 1 }
                  }
                }
              },
              false,
              'toCloseByPath'
            )
            return closed
          },

          toRelocatePath(fromPath, toPath) {
            set(
              function (state) {
                for (const tab of state.tabs) {
                  const next = relocateTabPath(tab.path, fromPath, toPath)
                  if (!next) continue
                  tab.path = next
                  tab.title = findFileName(next)
                  tab.language = findLanguageId(next)
                  if (tab.id === state.activeTabId) {
                    state.languageId = tab.language
                  }
                }
              },
              false,
              'toRelocatePath'
            )
          },

          toMarkDirty(id, isDirty = true) {
            set(
              function (state) {
                const tab = state.tabs.find(function (item) {
                  return item.id === id
                })
                if (tab) tab.isDirty = isDirty
              },
              false,
              'toMarkDirty'
            )
          },

          toMarkSaved(id) {
            set(
              function (state) {
                const tab = state.tabs.find(function (item) {
                  return item.id === id
                })
                if (tab) tab.isDirty = false
              },
              false,
              'toMarkSaved'
            )
          },

          toSetSidebarView(view) {
            set(
              function (state) {
                state.sidebarView = view
                state.isSidebarOpen = true
              },
              false,
              'toSetSidebarView'
            )
          },

          toToggleSidebar() {
            set(
              function (state) {
                state.isSidebarOpen = !state.isSidebarOpen
              },
              false,
              'toToggleSidebar'
            )
          },

          toToggleSidebarView(view) {
            set(
              function (state) {
                if (state.sidebarView === view && state.isSidebarOpen) {
                  state.isSidebarOpen = false
                  return
                }
                state.sidebarView = view
                state.isSidebarOpen = true
              },
              false,
              'toToggleSidebarView'
            )
          },

          toSetPanelOpen(isOpen) {
            set(
              function (state) {
                state.isPanelOpen = isOpen
              },
              false,
              'toSetPanelOpen'
            )
          },

          toTogglePanel(tab) {
            set(
              function (state) {
                if (tab) {
                  if (state.isPanelOpen && state.panelTab === tab) {
                    state.isPanelOpen = false
                    return
                  }
                  state.panelTab = tab
                  state.isPanelOpen = true
                  return
                }
                state.isPanelOpen = !state.isPanelOpen
              },
              false,
              'toTogglePanel'
            )
          },

          toSetPanelTab(tab) {
            set(
              function (state) {
                state.panelTab = tab
                state.isPanelOpen = true
              },
              false,
              'toSetPanelTab'
            )
          },

          toSetCursor(cursor) {
            set(
              function (state) {
                state.cursor = cursor
              },
              false,
              'toSetCursor'
            )
          },

          toSetLanguageId(languageId) {
            set(
              function (state) {
                state.languageId = languageId
                const active = findActiveTab(state)
                if (active) active.language = languageId
              },
              false,
              'toSetLanguageId'
            )
          },

          toSetPaletteMode(mode) {
            set(
              function (state) {
                state.paletteMode = mode
              },
              false,
              'toSetPaletteMode'
            )
          },

          toBumpTree() {
            set(
              function (state) {
                state.treeRevision += 1
              },
              false,
              'toBumpTree'
            )
          },

          toSetProblemCount(count) {
            set(
              function (state) {
                state.problemCount = count
              },
              false,
              'toSetProblemCount'
            )
          }
        }
      })
    ),
    {
      name: 'CodeStore',
      enabled: import.meta.env.DEV
    }
  )
)

export { useCodeStore }
export type { CodeTab, CursorPosition, SidebarView, PanelTab, PaletteMode }
