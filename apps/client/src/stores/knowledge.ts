import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { ensureTilePrefs } from '@/features/magnetic-tile/tile-prefs'
import type { KnowledgeDocRef } from '@/shared/ipc/specs/knowledge'
import type { OutlineItem } from '@/views/knowledge/lib/outline.ts'
import {
  hydratePreferencesFromStore,
  parsePreferences,
  persistPreferences,
  type KnowledgePreferences
} from '@/views/knowledge/lib/preferences.ts'
import type { DocStats } from '@/views/knowledge/lib/stats.ts'
import type { KnowledgeViewMode } from '@/views/knowledge/lib/types.ts'

interface KnowledgeSession {
  activePath: string | null
  /**
   * 侧栏文件树的根。优先恢复偏好里的 `workspaceRoot`（用户打开的文件夹）；
   * 切库时写入并落盘。打开/保存文件不得改写为「文件父目录」。
   */
  rootDir: string | null
  markdown: string
  frontMatter: string | null
  html: string
  isDirty: boolean
  isLoading: boolean
  hasOpened: boolean
  /**
   * 首屏会话是否已完成 hydrate + 尝试恢复上次文件。
   * 未就绪时主栏应显示骨架，避免 EmptyState / 空白编辑器闪一下。
   */
  isSessionReady: boolean
  stats: DocStats
  outline: OutlineItem[]
  findQuery: string
  findReplace: string
  fileQuery: string
  isFindOpen: boolean
  externalChanged: boolean
  isLargeFile: boolean
  /** 当前文档在知识库里的行引用（保存时用 hash 判冲突）；普通文件为 null */
  activeDoc: KnowledgeDocRef | null
  /** 保存时发现库内已被别处改过：等用户选「保留我的 / 重载」 */
  saveConflict: boolean
  treeRevision: number
}

interface KnowledgeStore extends KnowledgeSession, KnowledgePreferences {
  hydratePreferences: () => void
  /** 从 tiles.json 灌入（启动后） */
  hydrateFromStore: () => Promise<void>
  toPatchPreferences: (patch: Partial<KnowledgePreferences>) => void
  toOpenDocument(params: {
    path: string | null
    markdown: string
    frontMatter: string | null
    html: string
    isLargeFile?: boolean
  }): void
  /** 先切 activePath / 侧栏高亮，编辑器内容稍后灌入 */
  toBeginOpen: (path: string) => void
  /** 打开失败：撤掉 beginOpen 留下的空壳，回到未打开态 */
  toRevertFailedOpen: () => void
  toMarkSessionReady: () => void
  toSetLoading: (isLoading: boolean) => void
  toNewDocument: () => void
  toUpdateMarkdown: (markdown: string) => void
  toUpdateHtml: (html: string) => void
  toUpdateFrontMatter: (frontMatter: string | null) => void
  toMarkSaved: (path: string) => void
  /** 保存成功且内容仍是最新：一次写入 markdown + 清 dirty，避免先 dirty 再清除的闪烁 */
  toCommitSaved: (params: { path: string; markdown: string }) => void
  toMarkDirty: (isDirty?: boolean) => void
  toUpdateOutline: (outline: OutlineItem[]) => void
  toUpdateStats: (stats: DocStats) => void
  toSetViewMode: (mode: KnowledgeViewMode) => void
  /**
   * 切工作区根。
   * `persist: true`（打开文件夹 / 切库）会写入 `workspaceRoot`，刷新后可恢复。
   */
  toSetRootDir: (rootDir: string | null, options?: { persist?: boolean }) => void
  toToggleSidebar: () => void
  toToggleOutline: () => void
  toSetFindOpen: (isOpen: boolean) => void
  toSetFindQuery: (query: string) => void
  toSetFindReplace: (value: string) => void
  toSetFileQuery: (query: string) => void
  toSetExternalChanged: (isChanged: boolean) => void
  toSetActiveDoc: (doc: KnowledgeDocRef | null) => void
  toSetSaveConflict: (isConflict: boolean) => void
  toBumpTree: () => void
  toPushRecent: (path: string) => void
}

const EMPTY_STATS: DocStats = { chars: 0, words: 0, lines: 0 }

const useKnowledgeStore = create<KnowledgeStore>()(
  devtools(
    immer(function (setters, _finders) {
      const initial = parsePreferences()

      function writePrefs(state: KnowledgeStore): void {
        // state 是 immer 草稿代理；recentPaths 若按引用传入异步落盘，
        // 等 patchPref await 后草稿已被 revoke，parse 时 Array.isArray 会抛
        // 「Cannot perform 'IsArray' on a proxy that has been revoked」。
        // 这里先展开成普通数组，切断对草稿代理的引用。
        persistPreferences({
          isSidebarOpen: state.isSidebarOpen,
          isOutlineOpen: state.isOutlineOpen,
          viewMode: state.viewMode,
          fontSize: state.fontSize,
          contentMaxWidth: state.contentMaxWidth,
          autosaveMs: state.autosaveMs,
          isTypographyEnabled: state.isTypographyEnabled,
          isFocusMode: state.isFocusMode,
          isTypewriter: state.isTypewriter,
          recentPaths: [...state.recentPaths],
          workspaceRoot: state.workspaceRoot
        })
      }

      return {
        activePath: null,
        rootDir: initial.workspaceRoot,
        markdown: '',
        frontMatter: null,
        html: '',
        isDirty: false,
        isLoading: false,
        hasOpened: false,
        isSessionReady: false,
        stats: EMPTY_STATS,
        outline: [],
        findQuery: '',
        findReplace: '',
        fileQuery: '',
        isFindOpen: false,
        externalChanged: false,
        isLargeFile: false,
        activeDoc: null,
        saveConflict: false,
        treeRevision: 0,
        ...initial,

        hydratePreferences() {
          const prefs = parsePreferences()
          setters(
            function (state) {
              Object.assign(state, prefs)
              state.rootDir = prefs.workspaceRoot
            },
            false,
            'hydratePreferences'
          )
        },

        async hydrateFromStore() {
          await ensureTilePrefs()
          const prefs = hydratePreferencesFromStore()
          setters(
            function (state) {
              Object.assign(state, prefs)
              state.rootDir = prefs.workspaceRoot
            },
            false,
            'hydrateFromStore'
          )
        },

        toPatchPreferences(patch) {
          setters(
            function (state) {
              Object.assign(state, patch)
              writePrefs(state)
            },
            false,
            'toPatchPreferences'
          )
        },

        toOpenDocument(params) {
          setters(
            function (state) {
              state.activePath = params.path
              state.markdown = params.markdown
              state.frontMatter = params.frontMatter
              state.html = params.html
              state.isDirty = false
              state.hasOpened = true
              state.isLoading = false
              state.externalChanged = false
              state.activeDoc = null
              state.saveConflict = false
              state.isLargeFile = params.isLargeFile ?? false
              if (params.isLargeFile) {
                state.viewMode = 'source'
              }
            },
            false,
            'toOpenDocument'
          )
        },

        toBeginOpen(path) {
          setters(
            function (state) {
              state.activePath = path
              state.hasOpened = true
              state.isLoading = true
              state.isDirty = false
              state.externalChanged = false
            },
            false,
            'toBeginOpen'
          )
        },

        toRevertFailedOpen() {
          setters(
            function (state) {
              state.activePath = null
              state.markdown = ''
              state.frontMatter = null
              state.html = ''
              state.isDirty = false
              state.isLoading = false
              state.hasOpened = false
              state.externalChanged = false
              state.activeDoc = null
              state.saveConflict = false
              state.isLargeFile = false
              state.outline = []
              state.stats = EMPTY_STATS
            },
            false,
            'toRevertFailedOpen'
          )
        },

        toMarkSessionReady() {
          setters(
            function (state) {
              state.isSessionReady = true
            },
            false,
            'toMarkSessionReady'
          )
        },

        toSetLoading(isLoading) {
          setters(
            function (state) {
              state.isLoading = isLoading
            },
            false,
            'toSetLoading'
          )
        },

        toNewDocument() {
          setters(
            function (state) {
              state.activePath = null
              state.markdown = ''
              state.frontMatter = null
              state.html = '<p></p>'
              state.isDirty = false
              state.hasOpened = true
              state.isSessionReady = true
              state.externalChanged = false
              state.activeDoc = null
              state.saveConflict = false
              state.isLargeFile = false
              state.outline = []
              state.stats = EMPTY_STATS
            },
            false,
            'toNewDocument'
          )
        },

        toUpdateMarkdown(markdown) {
          setters(
            function (state) {
              state.markdown = markdown
              state.isDirty = true
            },
            false,
            'toUpdateMarkdown'
          )
        },

        toUpdateHtml(html) {
          setters(
            function (state) {
              state.html = html
              state.isDirty = true
            },
            false,
            'toUpdateHtml'
          )
        },

        toUpdateFrontMatter(frontMatter) {
          setters(
            function (state) {
              state.frontMatter = frontMatter
            },
            false,
            'toUpdateFrontMatter'
          )
        },

        toMarkSaved(path) {
          setters(
            function (state) {
              state.activePath = path
              state.isDirty = false
              state.externalChanged = false
            },
            false,
            'toMarkSaved'
          )
        },

        toCommitSaved(params) {
          setters(
            function (state) {
              state.activePath = params.path
              state.markdown = params.markdown
              state.isDirty = false
              state.externalChanged = false
              state.saveConflict = false
            },
            false,
            'toCommitSaved'
          )
        },

        toMarkDirty(isDirty = true) {
          setters(
            function (state) {
              state.isDirty = isDirty
            },
            false,
            'toMarkDirty'
          )
        },

        toUpdateOutline(outline) {
          setters(
            function (state) {
              state.outline = outline
            },
            false,
            'toUpdateOutline'
          )
        },

        toUpdateStats(stats) {
          setters(
            function (state) {
              state.stats = stats
            },
            false,
            'toUpdateStats'
          )
        },

        toSetViewMode(mode) {
          setters(
            function (state) {
              state.viewMode = mode
              writePrefs(state)
            },
            false,
            'toSetViewMode'
          )
        },

        toSetRootDir(rootDir, options) {
          setters(
            function (state) {
              state.rootDir = rootDir
              if (options?.persist) {
                state.workspaceRoot = rootDir
                writePrefs(state)
              }
            },
            false,
            'toSetRootDir'
          )
        },

        toToggleSidebar() {
          setters(
            function (state) {
              state.isSidebarOpen = !state.isSidebarOpen
              writePrefs(state)
            },
            false,
            'toToggleSidebar'
          )
        },

        toToggleOutline() {
          setters(
            function (state) {
              state.isOutlineOpen = !state.isOutlineOpen
              writePrefs(state)
            },
            false,
            'toToggleOutline'
          )
        },

        toSetFindOpen(isOpen) {
          setters(
            function (state) {
              state.isFindOpen = isOpen
            },
            false,
            'toSetFindOpen'
          )
        },

        toSetFindQuery(query) {
          setters(
            function (state) {
              state.findQuery = query
            },
            false,
            'toSetFindQuery'
          )
        },

        toSetFindReplace(value) {
          setters(
            function (state) {
              state.findReplace = value
            },
            false,
            'toSetFindReplace'
          )
        },

        toSetFileQuery(query) {
          setters(
            function (state) {
              state.fileQuery = query
            },
            false,
            'toSetFileQuery'
          )
        },

        toSetExternalChanged(isChanged) {
          setters(
            function (state) {
              state.externalChanged = isChanged
            },
            false,
            'toSetExternalChanged'
          )
        },

        toSetActiveDoc(doc) {
          setters(
            function (state) {
              state.activeDoc = doc
            },
            false,
            'toSetActiveDoc'
          )
        },

        toSetSaveConflict(isConflict) {
          setters(
            function (state) {
              state.saveConflict = isConflict
            },
            false,
            'toSetSaveConflict'
          )
        },

        toBumpTree() {
          setters(
            function (state) {
              state.treeRevision += 1
            },
            false,
            'toBumpTree'
          )
        },

        toPushRecent(path) {
          setters(
            function (state) {
              if (state.recentPaths[0] === path) return
              state.recentPaths = [
                path,
                ...state.recentPaths.filter(function (item) {
                  return item !== path
                })
              ].slice(0, 20)
              writePrefs(state)
            },
            false,
            'toPushRecent'
          )
        }
      }
    }),
    { name: 'markdown-store' }
  )
)

export type { KnowledgeViewMode, KnowledgeStore, KnowledgeSession }
export { useKnowledgeStore }
