import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@i-thinking/design/components/resizable'
import { cn } from 'cn'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { watch } from '@tauri-apps/plugin-fs'
import { useEditor as useComposer, type Editor } from '@tiptap/react'
import { clsx } from 'clsx'
import { startTransition, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useCommands } from '@/keyboard/react'
import { useMarkdownStore } from '@/stores/markdown'
import { writeBackup } from '@/views/markdown/lib/backup.ts'
import { exportHtmlDocument, printDocument } from '@/views/markdown/lib/export.ts'
import { findDisplayTitle, writeBinaryBesideDoc } from '@/views/markdown/lib/fs.ts'
import { parseMarkdown } from '@/views/markdown/lib/parse-markdown.ts'
import { serializeHtmlToMarkdown } from '@/views/markdown/lib/serialize-markdown.ts'
import { findOutlineFromEditor } from '@/views/markdown/lib/outline.ts'
import {
  createUntitled,
  findCurrentMarkdown,
  openFolderAsWorkspace,
  openPath,
  openWithDialog,
  saveDocument,
  syncDerived
} from '@/views/markdown/lib/session.ts'
import { t } from '@/views/markdown/locale.ts'
import { DiscardDialog } from '@/views/markdown/workspace/discard-dialog.tsx'
import { EmptyState } from '@/views/markdown/workspace/empty-state.tsx'
import { ExternalDialog } from '@/views/markdown/workspace/external-dialog.tsx'
import { findMarkdownExtensions } from '@/views/markdown/workspace/extensions.ts'
import { FindBar } from '@/views/markdown/workspace/find-bar.tsx'
import { FocusExit } from '@/views/markdown/workspace/focus-exit.tsx'
import { Overlay } from '@/views/markdown/workspace/overlay/index.ts'
import { PreferencesSheet } from '@/views/markdown/workspace/preferences-sheet.tsx'
import { SourceEditor } from '@/views/markdown/workspace/source-editor.tsx'

import styles from '@/views/markdown/workspace/markdown.module.scss'

type PendingAction = (() => void) | null

export default function MarkdownWorkspace() {
  const location = useLocation()
  const composerRef = useRef<Editor | null>(null)
  const liveScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRatioRef = useRef(0)
  const [scrollRatio, setScrollRatio] = useState(0)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [findPreferReplace, setFindPreferReplace] = useState(false)
  const pendingActionRef = useRef<PendingAction>(null)
  const syncingRef = useRef(false)
  const lastSavedRef = useRef('')

  const hasOpened = useMarkdownStore(function (state) {
    return state.hasOpened
  })
  const isDocLoading = useMarkdownStore(function (state) {
    return state.isLoading
  })
  const viewMode = useMarkdownStore(function (state) {
    return state.viewMode
  })
  const markdown = useMarkdownStore(function (state) {
    return state.markdown
  })
  const html = useMarkdownStore(function (state) {
    return state.html
  })
  const isDirty = useMarkdownStore(function (state) {
    return state.isDirty
  })
  const activePath = useMarkdownStore(function (state) {
    return state.activePath
  })
  const isSidebarOpen = useMarkdownStore(function (state) {
    return state.isSidebarOpen
  })
  const isOutlineOpen = useMarkdownStore(function (state) {
    return state.isOutlineOpen
  })
  const isFocusMode = useMarkdownStore(function (state) {
    return state.isFocusMode
  })
  const isFindOpen = useMarkdownStore(function (state) {
    return state.isFindOpen
  })
  const autosaveMs = useMarkdownStore(function (state) {
    return state.autosaveMs
  })
  const fontSize = useMarkdownStore(function (state) {
    return state.fontSize
  })
  const isTypographyEnabled = useMarkdownStore(function (state) {
    return state.isTypographyEnabled
  })
  const isTypewriter = useMarkdownStore(function (state) {
    return state.isTypewriter
  })
  const externalChanged = useMarkdownStore(function (state) {
    return state.externalChanged
  })
  const frontMatter = useMarkdownStore(function (state) {
    return state.frontMatter
  })

  const toUpdateMarkdown = useMarkdownStore(function (state) {
    return state.toUpdateMarkdown
  })
  const toUpdateHtml = useMarkdownStore(function (state) {
    return state.toUpdateHtml
  })
  const toUpdateOutline = useMarkdownStore(function (state) {
    return state.toUpdateOutline
  })
  const toSetFindOpen = useMarkdownStore(function (state) {
    return state.toSetFindOpen
  })
  const toSetExternalChanged = useMarkdownStore(function (state) {
    return state.toSetExternalChanged
  })
  const toPatchPreferences = useMarkdownStore(function (state) {
    return state.toPatchPreferences
  })
  const hydratePreferences = useMarkdownStore(function (state) {
    return state.hydratePreferences
  })

  function exitFocusMode() {
    toPatchPreferences({ isFocusMode: false })
  }

  function toggleFocusMode() {
    const next = !useMarkdownStore.getState().isFocusMode
    toPatchPreferences({ isFocusMode: next })
  }

  function handleImageFiles(files: FileList | null): boolean {
    if (!files || !activePath) return false
    let handled = false
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      handled = true
      void (async function () {
        const buffer = new Uint8Array(await file.arrayBuffer())
        const ext = file.type.split('/')[1] || 'png'
        const relative = await writeBinaryBesideDoc(
          activePath,
          `img-${Date.now()}.${ext}`,
          buffer
        )
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
        toUpdateHtml(nextHtml)
        const md = serializeHtmlToMarkdown(nextHtml, frontMatter)
        toUpdateMarkdown(md)
        syncDerived(md)
        toUpdateOutline(findOutlineFromEditor(props.editor))
      }
    },
    [isTypographyEnabled]
  )

  useEffect(
    function () {
      composerRef.current = composer
    },
    [composer]
  )

  useEffect(
    function () {
      hydratePreferences()
    },
    [hydratePreferences]
  )

  // Consume ?url= or restore last recent file once
  useEffect(
    function () {
      const params = new URLSearchParams(location.search)
      const url = params.get('url')
      if (url) {
        void openPath(decodeURIComponent(url))
        return
      }
      const recent = useMarkdownStore.getState().recentPaths[0]
      if (recent && !useMarkdownStore.getState().hasOpened) {
        void openPath(recent)
      }
    },
    [location.search]
  )

  // Window title + close intercept
  useEffect(
    function () {
      const title = findDisplayTitle(activePath, isDirty)
      void getCurrentWindow().setTitle(title)
      const label = document.querySelector('[data-slot="caption"]')
      if (label) {
        // Decorations summary updated via parent; title is enough for OS
      }
    },
    [activePath, isDirty]
  )

  useEffect(
    function () {
      let unlisten: (() => void) | undefined
      void getCurrentWindow()
        .onCloseRequested(async function (event) {
          if (!useMarkdownStore.getState().isDirty) return
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
    []
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
    [isDirty, activePath, autosaveMs, markdown]
  )

  // Periodic backup
  useEffect(
    function () {
      if (!isDirty) return
      const timer = window.setInterval(function () {
        const content = findCurrentMarkdown(composerRef.current?.getHTML())
        void writeBackup(activePath, content)
      }, 30000)
      return function () {
        window.clearInterval(timer)
      }
    },
    [isDirty, activePath]
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
          const state = useMarkdownStore.getState()
          if (!state.isDirty) {
            void openPath(activePath)
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

  // 等打开完成再灌编辑器，避免 toBeginOpen 时用旧 markdown 覆盖。
  // TipTap ReactRenderer 在已挂载时用 flushSync 渲染节点视图，
  // 不能在 effect 同步路径里 setContent，否则会触发 React 警告。
  useEffect(
    function () {
      if (!composer) return
      if (viewMode === 'source') return
      if (isDocLoading) return
      const state = useMarkdownStore.getState()
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
        const state = useMarkdownStore.getState()
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

  async function handleOpenFile() {
    runGuarded(function () {
      void openWithDialog().then(function (ok) {
        if (ok) {
          applyComposerFromStore(useMarkdownStore.getState().activePath)
        }
      })
    })
  }

  async function handleOpenFolder() {
    runGuarded(function () {
      void openFolderAsWorkspace().then(function (ok) {
        if (ok && !useMarkdownStore.getState().activePath) {
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
    const parsed = parseMarkdown(useMarkdownStore.getState().markdown)
    composer.commands.setContent(parsed.html || '<p></p>', { emitUpdate: false })
    syncingRef.current = false
  }

  function syncLiveToSource() {
    if (!composer) return
    const md = serializeHtmlToMarkdown(composer.getHTML(), frontMatter)
    toUpdateMarkdown(md)
    syncDerived(md)
  }

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

  // 标题栏应用菜单与快捷键都落到这张表：菜单直接 `runCommand(id)`，不再走 CustomEvent 总线，
  // 键位在 `keyboard/definitions.ts` 里按 id 关联。
  useCommands([
    {
      id: SHORTCUT_COMMAND.MARKDOWN_SAVE,
      title: '笔记：保存',
      keywords: 'save',
      group: '笔记',
      run: handleSave
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_OPEN_FILE,
      title: '笔记：打开文件…',
      keywords: 'open file',
      group: '笔记',
      run: handleOpenFile
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_OPEN_FOLDER,
      title: '笔记：打开文件夹…',
      keywords: 'open folder workspace',
      group: '笔记',
      run: handleOpenFolder
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_NEW,
      title: '笔记：新建',
      keywords: 'new',
      group: '笔记',
      run: handleNew
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FIND,
      title: '笔记：查找',
      keywords: 'find',
      group: '笔记',
      run: function () {
        setFindPreferReplace(false)
        toSetFindOpen(true)
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FIND_REPLACE,
      title: '笔记：查找并替换',
      keywords: 'replace',
      group: '笔记',
      run: function () {
        setFindPreferReplace(true)
        toSetFindOpen(true)
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_PRINT,
      title: '笔记：打印',
      keywords: 'print',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        printDocument(
          state.activePath?.split(/[/\\]/).pop() ?? t('UNTITLED'),
          composerRef.current?.getHTML() ?? state.html
        )
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_MODE_LIVE,
      title: '笔记：实时预览',
      keywords: 'live preview',
      group: '笔记',
      run: function () {
        useMarkdownStore.getState().toSetViewMode('live')
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_MODE_SOURCE,
      title: '笔记：源码模式',
      keywords: 'source',
      group: '笔记',
      run: function () {
        useMarkdownStore.getState().toSetViewMode('source')
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_MODE_SPLIT,
      title: '笔记：分屏模式',
      keywords: 'split',
      group: '笔记',
      run: function () {
        useMarkdownStore.getState().toSetViewMode('split')
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FOCUS_TOGGLE,
      title: '笔记：专注模式',
      keywords: 'focus',
      group: '笔记',
      run: toggleFocusMode
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_FOCUS_EXIT,
      title: '笔记：关闭查找 / 退出专注',
      keywords: 'exit focus escape',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        if (state.isFindOpen) {
          toSetFindOpen(false)
          return
        }
        if (state.isFocusMode) exitFocusMode()
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_EXPORT_HTML,
      title: '笔记：导出 HTML',
      keywords: 'export html',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        void exportHtmlDocument({
          activePath: state.activePath,
          html: composerRef.current?.getHTML() ?? state.html
        })
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_COPY_MARKDOWN,
      title: '笔记：复制 Markdown',
      keywords: 'copy markdown',
      group: '笔记',
      run: function () {
        const state = useMarkdownStore.getState()
        const md = serializeHtmlToMarkdown(
          composerRef.current?.getHTML() ?? state.html,
          state.frontMatter
        )
        return navigator.clipboard.writeText(md).then(function () {
          toast.success(t('COPY_MD'))
        })
      }
    },
    {
      id: SHORTCUT_COMMAND.MARKDOWN_COPY_HTML,
      title: '笔记：复制 HTML',
      keywords: 'copy html',
      group: '笔记',
      run: function () {
        const htmlContent = composerRef.current?.getHTML() ?? useMarkdownStore.getState().html
        return navigator.clipboard.writeText(htmlContent).then(function () {
          toast.success(t('COPY_HTML'))
        })
      }
    }
  ])

  function onOutlineJump(pos: number) {
    if (viewMode === 'source') {
      // approximate: scroll monaco via ratio later
      return
    }
    if (!composer) return
    composer.chain().focus().setTextSelection(pos).run()
    const dom = composer.view.domAtPos(pos)
    const element = (dom.node as HTMLElement).parentElement
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

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

  const showChrome = !isFocusMode
  const isDark = document.documentElement.classList.contains('dark')

  return (
    <div className={clsx([styles.markdown, styles.root, 'relative'])}>
      {isFocusMode ? <FocusExit onExit={exitFocusMode} /> : null}

      {showChrome ? (
        <Overlay.Utility
          onToggleFind={function () {
            setFindPreferReplace(false)
            toSetFindOpen(!isFindOpen)
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
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1">
          {showChrome && isSidebarOpen ? (
            <>
              <ResizablePanel
                defaultSize="16%"
                minSize="12%"
                maxSize="30%"
                className="min-h-0 min-w-0 overflow-hidden">
                <Overlay.Navigation onOpenPath={handleOpenPath} />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          ) : null}

          <ResizablePanel className="relative min-h-0 min-w-0 overflow-hidden bg-background/92">
            {isFindOpen ? (
              <FindBar
                editor={composer}
                preferReplace={findPreferReplace}
                clearToolbar={viewMode === 'live' && !isFocusMode}
              />
            ) : null}
            {isDocLoading ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
            ) : null}
            {viewMode === 'source' ? (
              <SourceEditor
                value={markdown}
                fontSize={fontSize}
                isDark={isDark}
                onChange={onSourceChange}
                onScrollRatio={onSourceScroll}
                scrollRatio={scrollRatio}
              />
            ) : null}

            {viewMode === 'live' ? (
              <Overlay.Section
                composer={composer}
                scrollHostRef={liveScrollRef}
                onScrollRatio={onLiveScroll}
              />
            ) : null}

            {viewMode === 'split' ? (
              <ResizablePanelGroup
                orientation="horizontal"
                className="h-full min-h-0">
                <ResizablePanel
                  defaultSize="50%"
                  className="min-h-0 min-w-0 overflow-hidden">
                  <SourceEditor
                    value={markdown}
                    fontSize={fontSize}
                    isDark={isDark}
                    onChange={onSourceChange}
                    onScrollRatio={onSourceScroll}
                    scrollRatio={scrollRatio}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel className="min-h-0 min-w-0 overflow-hidden">
                  <Overlay.Section
                    composer={composer}
                    isToolbarHidden
                    scrollHostRef={liveScrollRef}
                    onScrollRatio={onLiveScroll}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : null}
          </ResizablePanel>

          {showChrome && isOutlineOpen ? (
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
      )}

      <PreferencesSheet />
      <DiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={function () {
          setDiscardOpen(false)
          const action = pendingActionRef.current
          pendingActionRef.current = null
          useMarkdownStore.getState().toMarkDirty(false)
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
          toSetExternalChanged(false)
        }}
        onReload={function () {
          if (!activePath) return
          void openPath(activePath).then(function () {
            toSetExternalChanged(false)
            if (composer) {
              const state = useMarkdownStore.getState()
              syncingRef.current = true
              composer.commands.setContent(state.html || '<p></p>', {
                emitUpdate: false
              })
              syncingRef.current = false
            }
          })
        }}
      />
    </div>
  )
}
