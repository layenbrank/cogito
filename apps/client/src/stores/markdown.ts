import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { ensureTilePrefs } from '@/features/magnetic-tile/tile-prefs'
import type { OutlineItem } from '@/views/markdown/lib/outline.ts'
import {
  hydratePreferencesFromStore,
  parsePreferences,
  persistPreferences,
  type MarkdownPreferences
} from '@/views/markdown/lib/preferences.ts'
import type { DocStats } from '@/views/markdown/lib/stats.ts'
import type { MarkdownViewMode } from '@/views/markdown/lib/types.ts'

interface MarkdownSession {
  activePath: string | null
  markdown: string
  frontMatter: string | null
  html: string
  isDirty: boolean
  isLoading: boolean
  hasOpened: boolean
  stats: DocStats
  outline: OutlineItem[]
  findQuery: string
  findReplace: string
  fileQuery: string
  isFindOpen: boolean
  isPrefsOpen: boolean
  externalChanged: boolean
  isLargeFile: boolean
  treeRevision: number
}

interface MarkdownStore extends MarkdownSession, MarkdownPreferences {
  hydratePreferences: () => void
  /** 从 tiles.json 灌入（启动后） */
  hydrateFromStore: () => Promise<void>
  toPatchPreferences: (patch: Partial<MarkdownPreferences>) => void
  toOpenDocument(params: {
    path: string | null
    markdown: string
    frontMatter: string | null
    html: string
    isLargeFile?: boolean
  }): void
  /** 先切 activePath / 侧栏高亮，编辑器内容稍后灌入 */
  toBeginOpen: (path: string) => void
  toSetLoading: (isLoading: boolean) => void
  toNewDocument: () => void
  toUpdateMarkdown: (markdown: string) => void
  toUpdateHtml: (html: string) => void
  toUpdateFrontMatter: (frontMatter: string | null) => void
  toMarkSaved: (path: string) => void
  toMarkDirty: (isDirty?: boolean) => void
  toUpdateOutline: (outline: OutlineItem[]) => void
  toUpdateStats: (stats: DocStats) => void
  toSetViewMode: (mode: MarkdownViewMode) => void
  toToggleSidebar: () => void
  toToggleOutline: () => void
  toSetFindOpen: (isOpen: boolean) => void
  toSetFindQuery: (query: string) => void
  toSetFindReplace: (value: string) => void
  toSetFileQuery: (query: string) => void
  toSetPrefsOpen: (isOpen: boolean) => void
  toSetExternalChanged: (isChanged: boolean) => void
  toBumpTree: () => void
  toPushRecent: (path: string) => void
}

const EMPTY_STATS: DocStats = { chars: 0, words: 0, lines: 0 }

const useMarkdownStore = create<MarkdownStore>()(
  devtools(
    immer(function (setters, _finders) {
      const initial = parsePreferences()

      function writePrefs(state: MarkdownStore): void {
        // state 是 immer 草稿代理；recentPaths 若按引用传入异步落盘，
        // 等 patchPref await 后草稿已被 revoke，parse 时 Array.isArray 会抛
        // 「Cannot perform 'IsArray' on a proxy that has been revoked」。
        // 这里先展开成普通数组，切断对草稿代理的引用。
        persistPreferences({
          rootDir: state.rootDir,
          isSidebarOpen: state.isSidebarOpen,
          isOutlineOpen: state.isOutlineOpen,
          viewMode: state.viewMode,
          fontSize: state.fontSize,
          contentMaxWidth: state.contentMaxWidth,
          autosaveMs: state.autosaveMs,
          isTypographyEnabled: state.isTypographyEnabled,
          isFocusMode: state.isFocusMode,
          isTypewriter: state.isTypewriter,
          recentPaths: [...state.recentPaths]
        })
      }

      return {
        activePath: null,
        markdown: '',
        frontMatter: null,
        html: '',
        isDirty: false,
        isLoading: false,
        hasOpened: false,
        stats: EMPTY_STATS,
        outline: [],
        findQuery: '',
        findReplace: '',
        fileQuery: '',
        isFindOpen: false,
        isPrefsOpen: false,
        externalChanged: false,
        isLargeFile: false,
        treeRevision: 0,
        ...initial,

        hydratePreferences() {
          const prefs = parsePreferences()
          setters(
            function (state) {
              Object.assign(state, prefs)
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
              state.externalChanged = false
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

        toSetPrefsOpen(isOpen) {
          setters(
            function (state) {
              state.isPrefsOpen = isOpen
            },
            false,
            'toSetPrefsOpen'
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

export type { MarkdownViewMode, MarkdownStore, MarkdownSession }
export { useMarkdownStore }
