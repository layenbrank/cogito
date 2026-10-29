/**
 * 代码窗口 workbench 状态：工作区根、多 tab、侧栏/底栏、光标与命令面板。
 * 交互布局与上次打开的文件写入 tiles.json，重启后恢复。
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools, subscribeWithSelector } from 'zustand/middleware'

import { ensureTilePrefs } from '@/features/magnetic-tile/tile-prefs'
import { PERSIST_DEFAULTS } from '@/features/persist/defaults'
import { findLanguageId } from '@/views/code/lib/language.ts'
import {
  findFileName,
  isPathInsideRoot,
  isSamePath,
  normalizeSeparators,
  relocatePath
} from '@/views/code/lib/path.ts'
import {
  parseCodePreferences,
  persistCodePreferences,
  type CodePreferences
} from '@/views/code/lib/preferences.ts'

type SidebarView = 'explorer' | 'search' | 'scm'
type SurfaceTab = 'terminal' | 'problems'
type PaletteMode = 'command' | 'file' | null
/** 换行符：Monaco 只认这两种 */
type Eol = 'LF' | 'CRLF'

/** file：普通编辑；diff：工作区或提交间对比；commits：提交搜索（GitLens 式独立页） */
type CodeTabKind = 'file' | 'diff' | 'commits'

/** 提交搜索虚拟标签的固定 path，全局单例 */
const COMMITS_TAB_PATH = 'cogito://git/commits'

interface CodeTab {
  id: string
  path: string
  title: string
  language: string
  isDirty: boolean
  kind: CodeTabKind
  /** 提交 diff：父提交 oid（空串 = 空树）；缺省 = 工作区模式 */
  baseOid?: string
  /** 提交 diff：目标提交 oid */
  headOid?: string
}

interface CursorPosition {
  line: number
  column: number
}

/** 编辑器外观偏好：与 `tiles.json` 的 `code` 段一一对应 */
interface CodeEditorPrefs {
  fontSize: number
  lineHeightRatio: number
  fontFamily: string
  isLigaturesEnabled: boolean
}

interface CodeIndentation {
  tabSize: number
  insertSpaces: boolean
}

/** 诊断计数：错误与警告分开，状态栏与问题面板共用 */
interface ProblemCounts {
  errors: number
  warnings: number
}

/** 打开文件后要定位到的行列（搜索结果、问题跳转） */
interface RevealRequest {
  path: string
  line: number
  column: number
}

const CODE_DEFAULTS = PERSIST_DEFAULTS.tiles.code

interface CodeState {
  workspaceRoot: string | null
  tabs: CodeTab[]
  activeTabId: string | null
  sidebarView: SidebarView
  isSidebarOpen: boolean
  isSurfaceOpen: boolean
  surfaceTab: SurfaceTab
  cursor: CursorPosition
  languageId: string
  paletteMode: PaletteMode
  treeRevision: number
  problemCounts: ProblemCounts
  /** 资源管理器已展开的目录（相对路径，根目录用 `ROOT`） */
  expandedKeys: string[]
  pendingReveal: RevealRequest | null
  /** 等待用户确认关闭的标签（有未保存更改） */
  pendingCloseIds: string[]
  editorPrefs: CodeEditorPrefs
  indentation: CodeIndentation
  eol: Eol
  isHiddenVisible: boolean
  /** 当前文档超过只读阈值（大文件保护） */
  isLargeFile: boolean
  /** 正在从 store 恢复，跳过写回 */
  isHydrating: boolean

  toSetWorkspaceRoot: (root: string) => void
  toOpenTab(params: { path: string; language?: string }): void
  /** 打开/激活差异标签；与编辑标签可并存。带 oid 时为提交间对比。 */
  toOpenDiffTab(params: {
    path: string
    language?: string
    baseOid?: string
    headOid?: string
    titleHint?: string
  }): void
  /** 打开/激活提交搜索标签（GitLens Commits 式独立页，全局单例） */
  toOpenCommitsTab: () => void
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
  toUpdateSurfaceOpen: (isOpen: boolean) => void
  toToggleSurface: (tab?: SurfaceTab) => void
  toUpdateSurfaceTab: (tab: SurfaceTab) => void
  toSetCursor: (cursor: CursorPosition) => void
  toSetLanguageId: (languageId: string) => void
  toSetPaletteMode: (mode: PaletteMode) => void
  toBumpTree: () => void
  toToggleExpanded: (key: string, isOpen: boolean) => void
  /** 展开指定目录及其所有祖先（面包屑 / 在资源管理器中显示用） */
  toRevealPath: (relativeDir: string) => void
  toCollapseAll: () => void
  toRequestReveal: (request: RevealRequest | null) => void
  toSetPendingClose: (ids: string[]) => void
  toSetProblemCounts: (counts: ProblemCounts) => void
  toSetEditorPrefs: (patch: Partial<CodeEditorPrefs>) => void
  toSetIndentation: (indentation: CodeIndentation) => void
  toSetEol: (eol: Eol) => void
  toToggleHiddenVisible: () => void
  toSetLargeFile: (isLarge: boolean) => void
  /** 从 tiles.json 恢复 shell 偏好（不含打开文件内容） */
  hydrateFromStore: () => Promise<CodePreferences>
}

function findActiveTab(state: CodeState): CodeTab | undefined {
  return state.tabs.find(function (tab) {
    return tab.id === state.activeTabId
  })
}

function isFileTab(tab: CodeTab): boolean {
  return tab.kind === 'file'
}

function writeCodePrefs(state: CodeState): void {
  if (state.isHydrating) return
  const fileTabs = state.tabs.filter(isFileTab)
  const active = findActiveTab(state)
  const activeFile =
    active && isFileTab(active)
      ? active
      : fileTabs.find(function (tab) {
          return tab.id === state.activeTabId
        })
  persistCodePreferences({
    workspaceRoot: state.workspaceRoot,
    // 差异标签是会话态，不落盘（对齐 VS Code 不持久化 Working Tree 标签）
    tabPaths: fileTabs.map(function (tab) {
      return tab.path
    }),
    activePath: activeFile?.path ?? fileTabs[0]?.path ?? null,
    isSidebarOpen: state.isSidebarOpen,
    sidebarView: state.sidebarView,
    isSurfaceOpen: state.isSurfaceOpen,
    surfaceTab: state.surfaceTab,
    editorFontSize: state.editorPrefs.fontSize,
    editorLineHeightRatio: state.editorPrefs.lineHeightRatio,
    editorFontFamily: state.editorPrefs.fontFamily,
    isEditorLigaturesEnabled: state.editorPrefs.isLigaturesEnabled,
    isHiddenVisible: state.isHiddenVisible
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
          isSurfaceOpen: false,
          surfaceTab: 'terminal',
          cursor: { line: 1, column: 1 },
          languageId: 'plaintext',
          paletteMode: null,
          treeRevision: 0,
          problemCounts: { errors: 0, warnings: 0 },
          expandedKeys: [],
          pendingReveal: null,
          pendingCloseIds: [],
          editorPrefs: {
            fontSize: CODE_DEFAULTS.editorFontSize,
            lineHeightRatio: CODE_DEFAULTS.editorLineHeightRatio,
            fontFamily: CODE_DEFAULTS.editorFontFamily,
            isLigaturesEnabled: CODE_DEFAULTS.isEditorLigaturesEnabled
          },
          indentation: { tabSize: 2, insertSpaces: true },
          eol: 'LF',
          isHiddenVisible: CODE_DEFAULTS.isHiddenVisible,
          isLargeFile: false,
          isHydrating: false,

          toSetWorkspaceRoot(root) {
            set(
              function (state) {
                state.workspaceRoot = root
                const commitsTab = state.tabs.find(function (tab) {
                  return tab.kind === 'commits'
                })
                if (commitsTab) {
                  commitsTab.title = `提交: ${findFileName(root)}`
                }
              },
              false,
              'toSetWorkspaceRoot'
            )
          },

          toOpenTab(params) {
            set(
              function (state) {
                const existing = state.tabs.find(function (tab) {
                  return isFileTab(tab) && isSamePath(tab.path, params.path)
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
                  isDirty: false,
                  kind: 'file'
                })
                state.activeTabId = id
                state.languageId = language
              },
              false,
              'toOpenTab'
            )
          },

          toOpenDiffTab(params) {
            set(
              function (state) {
                const baseOid = params.baseOid
                const headOid = params.headOid
                const existing = state.tabs.find(function (tab) {
                  return (
                    tab.kind === 'diff' &&
                    isSamePath(tab.path, params.path) &&
                    tab.baseOid === baseOid &&
                    tab.headOid === headOid
                  )
                })
                if (existing) {
                  state.activeTabId = existing.id
                  state.languageId = existing.language
                  return
                }
                const language = params.language ?? findLanguageId(params.path)
                const id = crypto.randomUUID()
                const name = findFileName(params.path)
                const isRev = typeof headOid === 'string' && headOid.length > 0
                const hint =
                  params.titleHint ??
                  (isRev ? headOid.slice(0, 7) : '工作区')
                state.tabs.push({
                  id,
                  path: params.path,
                  title: `${name} (${hint})`,
                  language,
                  isDirty: false,
                  kind: 'diff',
                  baseOid,
                  headOid
                })
                state.activeTabId = id
                state.languageId = language
              },
              false,
              'toOpenDiffTab'
            )
          },

          toOpenCommitsTab() {
            set(
              function (state) {
                const existing = state.tabs.find(function (tab) {
                  return tab.kind === 'commits'
                })
                if (existing) {
                  state.activeTabId = existing.id
                  return
                }
                const rootName = state.workspaceRoot
                  ? findFileName(state.workspaceRoot)
                  : '仓库'
                const id = crypto.randomUUID()
                state.tabs.push({
                  id,
                  path: COMMITS_TAB_PATH,
                  title: `提交: ${rootName}`,
                  language: 'plaintext',
                  isDirty: false,
                  kind: 'commits'
                })
                state.activeTabId = id
              },
              false,
              'toOpenCommitsTab'
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
                  const next = relocatePath(tab.path, fromPath, toPath)
                  if (!next) continue
                  tab.path = next
                  const name = findFileName(next)
                  tab.title =
                    tab.kind === 'diff'
                      ? `${name} (${tab.headOid ? tab.headOid.slice(0, 7) : '工作区'})`
                      : name
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

          toUpdateSurfaceOpen(isOpen) {
            set(
              function (state) {
                state.isSurfaceOpen = isOpen
              },
              false,
              'toUpdateSurfaceOpen'
            )
          },

          toToggleSurface(tab) {
            set(
              function (state) {
                if (tab) {
                  if (state.isSurfaceOpen && state.surfaceTab === tab) {
                    state.isSurfaceOpen = false
                    return
                  }
                  state.surfaceTab = tab
                  state.isSurfaceOpen = true
                  return
                }
                state.isSurfaceOpen = !state.isSurfaceOpen
              },
              false,
              'toToggleSurface'
            )
          },

          toUpdateSurfaceTab(tab) {
            set(
              function (state) {
                state.surfaceTab = tab
                state.isSurfaceOpen = true
              },
              false,
              'toUpdateSurfaceTab'
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

          toToggleExpanded(key, isOpen) {
            set(
              function (state) {
                const index = state.expandedKeys.indexOf(key)
                if (isOpen && index < 0) state.expandedKeys.push(key)
                if (!isOpen && index >= 0) state.expandedKeys.splice(index, 1)
              },
              false,
              'toToggleExpanded'
            )
          },

          toRevealPath(relativeDir) {
            set(
              function (state) {
                const segments = normalizeSeparators(relativeDir).split('/').filter(Boolean)
                let current = ''
                for (const segment of segments) {
                  current = current ? `${current}/${segment}` : segment
                  if (!state.expandedKeys.includes(current)) state.expandedKeys.push(current)
                }
              },
              false,
              'toRevealPath'
            )
          },

          toCollapseAll() {
            set(
              function (state) {
                state.expandedKeys = []
              },
              false,
              'toCollapseAll'
            )
          },

          toRequestReveal(request) {
            set(
              function (state) {
                state.pendingReveal = request
              },
              false,
              'toRequestReveal'
            )
          },

          toSetPendingClose(ids) {
            set(
              function (state) {
                state.pendingCloseIds = ids
              },
              false,
              'toSetPendingClose'
            )
          },

          toSetProblemCounts(counts) {
            set(
              function (state) {
                state.problemCounts = counts
              },
              false,
              'toSetProblemCounts'
            )
          },

          toSetEditorPrefs(patch) {
            set(
              function (state) {
                state.editorPrefs = { ...state.editorPrefs, ...patch }
              },
              false,
              'toSetEditorPrefs'
            )
          },

          toSetIndentation(indentation) {
            set(
              function (state) {
                state.indentation = indentation
              },
              false,
              'toSetIndentation'
            )
          },

          toSetEol(eol) {
            set(
              function (state) {
                state.eol = eol
              },
              false,
              'toSetEol'
            )
          },

          toToggleHiddenVisible() {
            set(
              function (state) {
                state.isHiddenVisible = !state.isHiddenVisible
              },
              false,
              'toToggleHiddenVisible'
            )
          },

          toSetLargeFile(isLarge) {
            set(
              function (state) {
                state.isLargeFile = isLarge
              },
              false,
              'toSetLargeFile'
            )
          },

          async hydrateFromStore() {
            await ensureTilePrefs()
            const prefs = parseCodePreferences()
            set(
              function (state) {
                state.isHydrating = true
                state.workspaceRoot = prefs.workspaceRoot
                state.isSidebarOpen = prefs.isSidebarOpen
                state.sidebarView = prefs.sidebarView
                state.isSurfaceOpen = prefs.isSurfaceOpen
                state.surfaceTab = prefs.surfaceTab
                state.editorPrefs = {
                  fontSize: prefs.editorFontSize,
                  lineHeightRatio: prefs.editorLineHeightRatio,
                  fontFamily: prefs.editorFontFamily,
                  isLigaturesEnabled: prefs.isEditorLigaturesEnabled
                }
                state.isHiddenVisible = prefs.isHiddenVisible
                if (prefs.workspaceRoot) state.treeRevision += 1
              },
              false,
              'hydrateFromStore'
            )
            set(
              function (state) {
                state.isHydrating = false
              },
              false,
              'hydrateFromStore.done'
            )
            return prefs
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

useCodeStore.subscribe(function (state, previous) {
  if (state.isHydrating || previous.isHydrating) return
  if (
    state.workspaceRoot === previous.workspaceRoot &&
    state.tabs === previous.tabs &&
    state.activeTabId === previous.activeTabId &&
    state.isSidebarOpen === previous.isSidebarOpen &&
    state.sidebarView === previous.sidebarView &&
    state.isSurfaceOpen === previous.isSurfaceOpen &&
    state.surfaceTab === previous.surfaceTab &&
    state.editorPrefs === previous.editorPrefs &&
    state.isHiddenVisible === previous.isHiddenVisible
  ) {
    return
  }
  writeCodePrefs(state)
})

export { useCodeStore, COMMITS_TAB_PATH }
export type {
  CodeTab,
  CodeTabKind,
  CursorPosition,
  SidebarView,
  SurfaceTab,
  PaletteMode,
  Eol,
  CodeEditorPrefs,
  CodeIndentation,
  ProblemCounts,
  RevealRequest
}
