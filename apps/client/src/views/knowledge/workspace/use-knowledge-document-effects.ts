import { getCurrentWindow } from '@tauri-apps/api/window'
import { watch } from '@tauri-apps/plugin-fs'
import type { Editor } from '@tiptap/react'
import { useEffect } from 'react'

import { isMainWindow, MAIN_WINDOW_TITLE } from '@/features/magnetic-tile/session'
import { useKnowledgeStore } from '@/stores/knowledge'
import { clearDirListCache, findDisplayTitle } from '@/views/knowledge/lib/fs.ts'
import { openPath, saveDocument, shouldIgnoreFileWatch } from '@/views/knowledge/lib/session.ts'

type PendingAction = (() => void) | null

type WorkspaceState = ReturnType<typeof useKnowledgeStore.getState>

interface KnowledgeDocumentEffectsInput {
  composer: Editor | null
  composerRef: { current: Editor | null }
  syncingRef: { current: boolean }
  lastSavedRef: { current: string }
  pendingActionRef: { current: PendingAction }
  activePath: string | null
  rootDir: string | null
  viewMode: WorkspaceState['viewMode']
  isDocLoading: boolean
  isDirty: boolean
  autosaveMs: number
  markdown: string
  toSetExternalChanged: WorkspaceState['toSetExternalChanged']
  toBumpTree: WorkspaceState['toBumpTree']
  setDiscardOpen: (value: boolean) => void
}

/** 工作区文档级副作用：编辑器灌入、窗口标题、关闭拦截、自动保存与外部文件监听 */
function useKnowledgeDocumentEffects(input: KnowledgeDocumentEffectsInput) {
  const {
    composer,
    composerRef,
    syncingRef,
    lastSavedRef,
    pendingActionRef,
    activePath,
    rootDir,
    viewMode,
    isDocLoading,
    isDirty,
    autosaveMs,
    markdown,
    toSetExternalChanged,
    toBumpTree,
    setDiscardOpen
  } = input

  useEffect(
    function () {
      composerRef.current = composer
    },
    [composer, composerRef]
  )

  useEffect(
    function () {
      const title = findDisplayTitle(activePath, isDirty)
      void getCurrentWindow().setTitle(title)
    },
    [activePath, isDirty]
  )

  useEffect(function () {
    return function () {
      if (!isMainWindow()) return
      void getCurrentWindow().setTitle(MAIN_WINDOW_TITLE)
    }
  }, [])

  useEffect(
    function () {
      let unlisten: (() => void) | undefined
      void getCurrentWindow()
        .onCloseRequested(function (event) {
          if (!useKnowledgeStore.getState().isDirty) return
          event.preventDefault()
          pendingActionRef.current = function () {
            void getCurrentWindow().destroy()
          }
          setDiscardOpen(true)
        })
        .then(function (fn) {
          unlisten = fn
        })
      return function () {
        unlisten?.()
      }
    },
    [pendingActionRef, setDiscardOpen]
  )

  useEffect(
    function () {
      if (!isDirty || !activePath || autosaveMs <= 0) return
      const timer = window.setTimeout(function () {
        void saveDocument({ liveHtml: composerRef.current?.getHTML() })
      }, autosaveMs)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [isDirty, activePath, autosaveMs, markdown, composerRef]
  )

  useEffect(
    function () {
      if (!activePath) return
      let disposed = false
      let unwatch: (() => void) | undefined
      void watch(
        activePath,
        function () {
          if (disposed) return
          if (shouldIgnoreFileWatch()) return
          const state = useKnowledgeStore.getState()
          if (!state.isDirty) {
            void openPath(activePath, { force: true })
            return
          }
          toSetExternalChanged(true)
        },
        { delayMs: 400 }
      )
        .then(function (fn) {
          if (disposed) {
            fn()
            return
          }
          unwatch = fn
        })
        .catch(function () {
          /* Command watch not found */
        })
      return function () {
        disposed = true
        try {
          const result = unwatch?.() as void | Promise<void>
          if (result && typeof result.then === 'function') {
            void result.catch(function (error) {
              console.warn('[knowledge] file unwatch failed', error)
            })
          }
        } catch (error) {
          console.warn('[knowledge] file unwatch failed', error)
        }
      }
    },
    [activePath, toSetExternalChanged]
  )

  useEffect(
    function () {
      if (!rootDir) return
      let disposed = false
      let unwatch: (() => void) | undefined
      let debounceTimer = 0
      void watch(
        rootDir,
        function () {
          if (disposed) return
          window.clearTimeout(debounceTimer)
          debounceTimer = window.setTimeout(function () {
            if (disposed) return
            clearDirListCache()
            toBumpTree()
          }, 350)
        },
        { recursive: true, delayMs: 500 }
      )
        .then(function (fn) {
          if (disposed) {
            fn()
            return
          }
          unwatch = fn
        })
        .catch(function () {
          /* Command watch not found */
        })
      return function () {
        disposed = true
        window.clearTimeout(debounceTimer)
        try {
          const result = unwatch?.() as void | Promise<void>
          if (result && typeof result.then === 'function') {
            void result.catch(function (error) {
              console.warn('[knowledge] tree unwatch failed', error)
            })
          }
        } catch (error) {
          console.warn('[knowledge] tree unwatch failed', error)
        }
      }
    },
    [rootDir, toBumpTree]
  )

  useEffect(
    function () {
      if (!composer) return
      if (viewMode === 'source') return
      if (isDocLoading) return
      const state = useKnowledgeStore.getState()
      const nextHtml = state.html || '<p></p>'
      const nextSaved = state.markdown
      let cancelled = false
      queueMicrotask(function () {
        if (cancelled || !composerRef.current) return
        syncingRef.current = true
        composerRef.current.commands.setContent(nextHtml, {
          emitUpdate: false
        })
        lastSavedRef.current = nextSaved
        queueMicrotask(function () {
          syncingRef.current = false
        })
      })
      return function () {
        cancelled = true
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePath, composer, viewMode, isDocLoading]
  )
}

export { useKnowledgeDocumentEffects }
export type { PendingAction, KnowledgeDocumentEffectsInput }
