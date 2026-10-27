import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import { cn } from 'cn'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { watch } from '@tauri-apps/plugin-fs'
import { useEditor as useComposer, type Editor } from '@tiptap/react'
import { clsx } from 'clsx'
import { startTransition, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { isMainWindow, MAIN_WINDOW_TITLE } from '@/features/magnetic-tile/session'
import { useKnowledgeStore } from '@/stores/knowledge'
import { clearDirListCache, findDisplayTitle } from '@/views/knowledge/lib/fs.ts'
import { uploadMarkdownImage } from '@/views/knowledge/lib/image-upload.ts'
import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'
import { findOutlineFromEditor } from '@/views/knowledge/lib/outline.ts'
import {
  createUntitled,
  openFolderAsWorkspace,
  openPath,
  openWithDialog,
  saveDocument,
  syncDerived
} from '@/views/knowledge/lib/session.ts'
import { t } from '@/views/knowledge/locale.ts'
import { DiscardDialog } from '@/views/knowledge/workspace/discard-dialog.tsx'
import { EmptyState } from '@/views/knowledge/workspace/empty-state.tsx'
import { ExternalDialog } from '@/views/knowledge/workspace/external-dialog.tsx'
import { findMarkdownExtensions } from '@/views/knowledge/workspace/extensions.ts'
import { FindBar } from '@/views/knowledge/workspace/find-bar.tsx'
import { FocusExit } from '@/views/knowledge/workspace/focus-exit.tsx'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'
import { PreferencesSheet } from '@/views/knowledge/workspace/preferences-sheet.tsx'
import { SourceEditor } from '@/views/knowledge/workspace/source-editor.tsx'
import { useKnowledgeCommands } from '@/views/knowledge/workspace/use-knowledge-commands.ts'

import styles from '@/views/knowledge/workspace/markdown.module.scss'

type PendingAction = (() => void) | null

type WorkspaceState = ReturnType<typeof useKnowledgeStore.getState>

/**
 * 工作区文档级副作用：编辑器灌入、偏好加载、?url 还原、窗口标题、关闭拦截、
 * 自动保存、周期备份与外部文件监听。
 */
function useKnowledgeDocumentEffects(input: {
  composer: Editor | null
  composerRef: { current: Editor | null }
  syncingRef: { current: boolean }
  lastSavedRef: { current: string }
  pendingActionRef: { current: PendingAction }
  search: string
  activePath: string | null
  rootDir: string | null
  viewMode: WorkspaceState['viewMode']
  isDocLoading: boolean
  isDirty: boolean
  autosaveMs: number
  markdown: string
  hydratePreferences: WorkspaceState['hydratePreferences']
  toSetExternalChanged: WorkspaceState['toSetExternalChanged']
  toBumpTree: WorkspaceState['toBumpTree']
  setDiscardOpen: (value: boolean) => void
}) {
  const {
    composer,
    composerRef,
    syncingRef,
    lastSavedRef,
    pendingActionRef,
    search,
    activePath,
    rootDir,
    viewMode,
    isDocLoading,
    isDirty,
    autosaveMs,
    markdown,
    hydratePreferences,
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
      hydratePreferences()
    },
    [hydratePreferences]
  )

  // 灌入 tiles 偏好后：消费 ?url=，否则恢复上次打开的文件
  useEffect(
    function () {
      let cancelled = false
      void (async function () {
        await useKnowledgeStore.getState().hydrateFromStore()
        if (cancelled) return
        const params = new URLSearchParams(search)
        const url = params.get('url')
        if (url) {
          void openPath(decodeURIComponent(url))
          return
        }
        const state = useKnowledgeStore.getState()
        const recent = state.recentPaths[0]
        if (recent && !state.hasOpened) {
          void openPath(recent)
        }
      })()
      return function () {
        cancelled = true
      }
    },
    [search]
  )

  // Window title + close intercept
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

  // Autosave
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

  // External file watch（插件未注册时静默跳过）
  useEffect(
    function () {
      if (!activePath) return
      let disposed = false
      let unwatch: (() => void) | undefined
      void watch(
        activePath,
        function () {
          if (disposed) return
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
          /* Command watch not found — 当前壳未启用 fs watch */
        })
      return function () {
        disposed = true
        unwatch?.()
      }
    },
    [activePath, toSetExternalChanged]
  )

  // 工作区目录递归监听：文件树随磁盘创建/删除/重命名刷新
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
          /* Command watch not found — 当前壳未启用 fs watch */
        })
      return function () {
        disposed = true
        window.clearTimeout(debounceTimer)
        unwatch?.()
      }
    },
    [rootDir, toBumpTree]
  )

  // 等打开完成再灌编辑器，避免 toBeginOpen 时用旧 markdown 覆盖。
  // TipTap ReactRenderer 在已挂载时用 flushSync 渲染节点视图，
  // 不能在 effect 同步路径里 setContent，否则会触发 React 警告。
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

/** 打开 / 新建 / 保存 与源码⇄实时 的文档动作 */
function useKnowledgeFileActions(input: {
  composer: Editor | null
  composerRef: { current: Editor | null }
  syncingRef: { current: boolean }
  pendingActionRef: { current: PendingAction }
  frontMatter: WorkspaceState['frontMatter']
  isDirty: boolean
  toUpdateMarkdown: WorkspaceState['toUpdateMarkdown']
  toUpdateHtml: WorkspaceState['toUpdateHtml']
  setDiscardOpen: (value: boolean) => void
}) {
  const {
    composer,
    composerRef,
    syncingRef,
    pendingActionRef,
    frontMatter,
    isDirty,
    toUpdateMarkdown,
    toUpdateHtml,
    setDiscardOpen
  } = input

  function runGuarded(action: () => void) {
    if (!isDirty) {
      action()
      return
    }
    pendingActionRef.current = action
    setDiscardOpen(true)
  }

  function applyComposerFromStore(expectedPath?: string | null) {
    if (!composer) return
    // 侧栏高亮已同步；编辑器灌入降为低优先级，避免整页卡顿
    startTransition(function () {
      requestAnimationFrame(function () {
        if (!composerRef.current) return
        const state = useKnowledgeStore.getState()
        if (expectedPath) {
          const current = state.activePath?.replace(/\\/g, '/').toLowerCase()
          const expected = expectedPath.replace(/\\/g, '/').toLowerCase()
          if (current !== expected) return
        }
        const nextHtml = state.html || '<p></p>'
        syncingRef.current = true
        composerRef.current.commands.setContent(nextHtml, {
          emitUpdate: false
        })
        syncingRef.current = false
      })
    })
  }

  function handleOpenFile() {
    runGuarded(function () {
      void openWithDialog().then(function (ok) {
        if (ok) {
          applyComposerFromStore(useKnowledgeStore.getState().activePath)
        }
      })
    })
  }

  function handleOpenFolder() {
    runGuarded(function () {
      void openFolderAsWorkspace().then(function (ok) {
        if (ok && !useKnowledgeStore.getState().activePath) {
          applyComposerFromStore()
        }
      })
    })
  }

  function handleNew() {
    runGuarded(function () {
      createUntitled()
      if (composer) {
        syncingRef.current = true
        composer.commands.setContent('<p></p>', { emitUpdate: false })
        syncingRef.current = false
      }
    })
  }

  function handleOpenPath(path: string) {
    runGuarded(function () {
      void openPath(path).then(function (ok) {
        if (ok) applyComposerFromStore(path)
      })
    })
  }

  async function handleSave() {
    await saveDocument({ liveHtml: composer?.getHTML() })
  }

  function onSourceChange(value: string) {
    if (syncingRef.current) return
    toUpdateMarkdown(value)
    syncDerived(value)
    const parsed = parseMarkdown(value)
    toUpdateHtml(parsed.html)
  }

  function syncSourceToLive() {
    if (!composer) return
    syncingRef.current = true
    const parsed = parseMarkdown(useKnowledgeStore.getState().markdown)
    composer.commands.setContent(parsed.html || '<p></p>', { emitUpdate: false })
    syncingRef.current = false
  }

  function syncLiveToSource() {
    if (!composer) return
    const md = serializeHtmlToMarkdown(composer.getHTML(), frontMatter)
    toUpdateMarkdown(md)
    syncDerived(md)
  }

  return {
    handleOpenFile,
    handleOpenFolder,
    handleNew,
    handleOpenPath,
    handleSave,
    onSourceChange,
    syncSourceToLive,
    syncLiveToSource
  }
}

/** 主工作区：侧栏 / 编辑区 / 大纲三栏，按视图模式切换源码 / 实时 / 分屏 */
function WorkspaceSurfaces(props: {
  isShellVisible: boolean
  isSidebarOpen: boolean
  isOutlineOpen: boolean
  isFindOpen: boolean
  isFocusMode: boolean
  isDocLoading: boolean
  findPreferReplace: boolean
  viewMode: WorkspaceState['viewMode']
  composer: Editor | null
  markdown: string
  fontSize: number
  isDark: boolean
  onOpenPath: (path: string) => void
  onSourceChange: (value: string) => void
}) {
  const liveScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRatioRef = useRef(0)
  const [scrollRatio, setScrollRatio] = useState(0)

  function onLiveScroll(ratio: number) {
    scrollRatioRef.current = ratio
    setScrollRatio(ratio)
  }

  function onSourceScroll(ratio: number) {
    scrollRatioRef.current = ratio
    setScrollRatio(ratio)
    const host = liveScrollRef.current
    if (!host) return
    const max = host.scrollHeight - host.clientHeight
    if (max > 0) host.scrollTop = max * ratio
  }

  function onOutlineJump(pos: number) {
    if (props.viewMode === 'source') {
      // approximate: scroll monaco via ratio later
      return
    }
    if (!props.composer) return
    props.composer.chain().focus().setTextSelection(pos).run()
    const dom = props.composer.view.domAtPos(pos)
    const element = (dom.node as HTMLElement).parentElement
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1">
        {props.isShellVisible && props.isSidebarOpen ? (
        <>
          <ResizablePanel
            defaultSize="16%"
            minSize="12%"
            maxSize="30%"
            className="min-h-0 min-w-0 overflow-hidden">
            <Overlay.Navigation onOpenPath={props.onOpenPath} />
          </ResizablePanel>
          <ResizableHandle withHandle />
        </>
      ) : null}

      <ResizablePanel className="relative min-h-0 min-w-0 overflow-hidden bg-background/92">
        {props.isFindOpen ? (
          <FindBar
            editor={props.composer}
            preferReplace={props.findPreferReplace}
            clearToolbar={props.viewMode === 'live' && !props.isFocusMode}
          />
        ) : null}
        {props.isDocLoading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : null}
        {props.viewMode === 'source' ? (
          <SourceEditor
            value={props.markdown}
            fontSize={props.fontSize}
            isDark={props.isDark}
            onChange={props.onSourceChange}
            onScrollRatio={onSourceScroll}
            scrollRatio={scrollRatio}
          />
        ) : null}

        {props.viewMode === 'live' ? (
          <Overlay.Section
            composer={props.composer}
            scrollHostRef={liveScrollRef}
            onScrollRatio={onLiveScroll}
          />
        ) : null}

        {props.viewMode === 'split' ? (
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full min-h-0">
            <ResizablePanel
              defaultSize="50%"
              className="min-h-0 min-w-0 overflow-hidden">
              <SourceEditor
                value={props.markdown}
                fontSize={props.fontSize}
                isDark={props.isDark}
                onChange={props.onSourceChange}
                onScrollRatio={onSourceScroll}
                scrollRatio={scrollRatio}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel className="min-h-0 min-w-0 overflow-hidden">
              <Overlay.Section
                composer={props.composer}
                isToolbarHidden
                scrollHostRef={liveScrollRef}
                onScrollRatio={onLiveScroll}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : null}
      </ResizablePanel>

        {props.isShellVisible && props.isOutlineOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="14%"
            minSize="10%"
            maxSize="28%"
            className="min-h-0 min-w-0 overflow-hidden">
            <Overlay.Outline onJump={onOutlineJump} />
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}

export default function KnowledgeWorkspace() {
  const location = useLocation()
  const composerRef = useRef<Editor | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [findPreferReplace, setFindPreferReplace] = useState(false)
  const pendingActionRef = useRef<PendingAction>(null)
  const syncingRef = useRef(false)
  const lastSavedRef = useRef('')

  const hasOpened = useKnowledgeStore(function (state) {
    return state.hasOpened
  })
  const isDocLoading = useKnowledgeStore(function (state) {
    return state.isLoading
  })
  const viewMode = useKnowledgeStore(function (state) {
    return state.viewMode
  })
  const markdown = useKnowledgeStore(function (state) {
    return state.markdown
  })
  const html = useKnowledgeStore(function (state) {
    return state.html
  })
  const isDirty = useKnowledgeStore(function (state) {
    return state.isDirty
  })
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const isSidebarOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const isOutlineOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const isFindOpen = useKnowledgeStore(function (state) {
    return state.isFindOpen
  })
  const autosaveMs = useKnowledgeStore(function (state) {
    return state.autosaveMs
  })
  const fontSize = useKnowledgeStore(function (state) {
    return state.fontSize
  })
  const isTypographyEnabled = useKnowledgeStore(function (state) {
    return state.isTypographyEnabled
  })
  const isTypewriter = useKnowledgeStore(function (state) {
    return state.isTypewriter
  })
  const externalChanged = useKnowledgeStore(function (state) {
    return state.externalChanged
  })
  const saveConflict = useKnowledgeStore(function (state) {
    return state.saveConflict
  })
  const frontMatter = useKnowledgeStore(function (state) {
    return state.frontMatter
  })

  function exitFocusMode() {
    useKnowledgeStore.getState().toPatchPreferences({ isFocusMode: false })
  }

  function toggleFocusMode() {
    const next = !useKnowledgeStore.getState().isFocusMode
    useKnowledgeStore.getState().toPatchPreferences({ isFocusMode: next })
  }

  function handleImageFiles(files: FileList | null): boolean {
    if (!files || !activePath) return false
    let handled = false
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      handled = true
      void (async function () {
        const relative = await uploadMarkdownImage(file)
        composerRef.current?.chain().focus().setImage({ src: relative }).run()
        toast.success(t('IMAGE_SAVED'))
      })()
    }
    return handled
  }

  const composer = useComposer(
    {
      immediatelyRender: false,
      extensions: findMarkdownExtensions({ isTypographyEnabled }),
      content: html || '',
      editorProps: {
        attributes: {
          class: cn(
            'prose prose-neutral dark:prose-invert max-w-none focus:outline-none',
            isTypewriter && 'min-h-[70vh]'
          )
        },
        handlePaste(_view, event) {
          return handleImageFiles(event.clipboardData?.files ?? null)
        },
        handleDrop(_view, event) {
          if (!event.dataTransfer?.files?.length) return false
          event.preventDefault()
          return handleImageFiles(event.dataTransfer.files)
        }
      },
      onUpdate(props) {
        if (syncingRef.current) return
        const nextHtml = props.editor.getHTML()
        useKnowledgeStore.getState().toUpdateHtml(nextHtml)
        const md = serializeHtmlToMarkdown(nextHtml, frontMatter)
        useKnowledgeStore.getState().toUpdateMarkdown(md)
        syncDerived(md)
        useKnowledgeStore.getState().toUpdateOutline(findOutlineFromEditor(props.editor))
      }
    },
    [isTypographyEnabled]
  )

  useKnowledgeDocumentEffects({
    composer,
    composerRef,
    syncingRef,
    lastSavedRef,
    pendingActionRef,
    search: location.search,
    activePath,
    rootDir,
    viewMode,
    isDocLoading,
    isDirty,
    autosaveMs,
    markdown,
    hydratePreferences: useKnowledgeStore.getState().hydratePreferences,
    toSetExternalChanged: useKnowledgeStore.getState().toSetExternalChanged,
    toBumpTree: useKnowledgeStore.getState().toBumpTree,
    setDiscardOpen
  })

  const {
    handleOpenFile,
    handleOpenFolder,
    handleNew,
    handleOpenPath,
    handleSave,
    onSourceChange,
    syncSourceToLive,
    syncLiveToSource
  } = useKnowledgeFileActions({
    composer,
    composerRef,
    syncingRef,
    pendingActionRef,
    frontMatter,
    isDirty,
    toUpdateMarkdown: useKnowledgeStore.getState().toUpdateMarkdown,
    toUpdateHtml: useKnowledgeStore.getState().toUpdateHtml,
    setDiscardOpen
  })

  // When leaving a mode, flush SoT
  const prevModeRef = useRef(viewMode)
  useEffect(
    function () {
      const prev = prevModeRef.current
      if (prev === viewMode) return
      if (prev === 'live' || (prev === 'split' && viewMode === 'source')) {
        syncLiveToSource()
      } else if (prev === 'source' || (prev === 'split' && viewMode === 'live')) {
        syncSourceToLive()
      }
      prevModeRef.current = viewMode
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewMode]
  )

  useKnowledgeCommands({
    composerRef,
    onSave: handleSave,
    onOpenFile: handleOpenFile,
    onOpenFolder: handleOpenFolder,
    onNew: handleNew,
    onToggleFocus: toggleFocusMode,
    onExitFocus: exitFocusMode,
    onFind: function (withReplace) {
      setFindPreferReplace(withReplace)
      useKnowledgeStore.getState().toSetFindOpen(true)
    }
  })

  const isShellVisible = !isFocusMode
  const isDark = document.documentElement.classList.contains('dark')

  return (
    <div className={clsx([styles.markdown, styles.root, 'relative'])}>
      {isFocusMode ? <FocusExit onExit={exitFocusMode} /> : null}

      {isShellVisible ? (
        <Overlay.Utility
          onToggleFind={function () {
            setFindPreferReplace(false)
            useKnowledgeStore.getState().toSetFindOpen(!isFindOpen)
          }}
        />
      ) : null}

      {!hasOpened ? (
        <EmptyState
          onOpenFile={function () {
            void handleOpenFile()
          }}
          onOpenFolder={function () {
            void handleOpenFolder()
          }}
          onNew={handleNew}
          onOpenRecent={handleOpenPath}
        />
      ) : (
        <WorkspaceSurfaces
          isShellVisible={isShellVisible}
          isSidebarOpen={isSidebarOpen}
          isOutlineOpen={isOutlineOpen}
          isFindOpen={isFindOpen}
          isFocusMode={isFocusMode}
          isDocLoading={isDocLoading}
          findPreferReplace={findPreferReplace}
          viewMode={viewMode}
          composer={composer}
          markdown={markdown}
          fontSize={fontSize}
          isDark={isDark}
          onOpenPath={handleOpenPath}
          onSourceChange={onSourceChange}
        />
      )}

      <PreferencesSheet />
      <DiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={function () {
          setDiscardOpen(false)
          const action = pendingActionRef.current
          pendingActionRef.current = null
          useKnowledgeStore.getState().toMarkDirty(false)
          action?.()
        }}
        onSave={function () {
          void saveDocument({ liveHtml: composer?.getHTML() }).then(function (ok) {
            if (!ok) return
            setDiscardOpen(false)
            const action = pendingActionRef.current
            pendingActionRef.current = null
            action?.()
          })
        }}
      />
      <ExternalDialog
        open={externalChanged}
        onKeep={function () {
          useKnowledgeStore.getState().toSetExternalChanged(false)
        }}
        onReload={function () {
          if (!activePath) return
          void openPath(activePath).then(function () {
            useKnowledgeStore.getState().toSetExternalChanged(false)
            if (composer) {
              const state = useKnowledgeStore.getState()
              syncingRef.current = true
              composer.commands.setContent(state.html || '<p></p>', {
                emitUpdate: false
              })
              syncingRef.current = false
            }
          })
        }}
      />
      {/* 保存时发现库内已被别处改过：保留我的（强制覆盖）或重载 */}
      <ExternalDialog
        open={saveConflict}
        onKeep={function () {
          useKnowledgeStore.getState().toSetSaveConflict(false)
          void saveDocument({ liveHtml: composer?.getHTML(), force: true })
        }}
        onReload={function () {
          useKnowledgeStore.getState().toSetSaveConflict(false)
          if (!activePath) return
          void openPath(activePath, { force: true }).then(function () {
            if (!composer) return
            const state = useKnowledgeStore.getState()
            syncingRef.current = true
            composer.commands.setContent(state.html || '<p></p>', {
              emitUpdate: false
            })
            syncingRef.current = false
          })
        }}
      />
    </div>
  )
}
