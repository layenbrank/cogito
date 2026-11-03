import { cn } from 'cn'
import { useEditor as useComposer, type Editor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeStore } from '@/stores/knowledge'
import {
  findClipboardImages,
  findNativeClipboardImage,
  uploadMarkdownImage
} from '@/views/knowledge/lib/image-upload.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'
import { findOutlineFromEditor } from '@/views/knowledge/lib/outline.ts'
import { openPath, saveDocument, syncDerived } from '@/views/knowledge/lib/session.ts'
import { t } from '@/views/knowledge/locale.ts'
import { rememberEditorBridge } from '@/views/knowledge/workspace/editor-context.ts'
import { findMarkdownExtensions } from '@/views/knowledge/workspace/extensions.ts'
import { useKnowledgeCommands } from '@/views/knowledge/workspace/use-knowledge-commands.ts'
import {
  useKnowledgeDocumentEffects,
  type PendingAction
} from '@/views/knowledge/workspace/use-knowledge-document-effects.ts'
import { useKnowledgeFileActions } from '@/views/knowledge/workspace/use-knowledge-file-actions.ts'

function useKnowledgeWorkspace() {
  const composerRef = useRef<Editor | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [findPreferReplace, setFindPreferReplace] = useState(false)
  const pendingActionRef = useRef<PendingAction>(null)
  const syncingRef = useRef(false)
  const lastSavedRef = useRef('')

  const isSessionReady = useKnowledgeStore(function (state) {
    return state.isSessionReady
  })
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

  function toggleFindOpen() {
    useKnowledgeStore.getState().toSetFindOpen(!useKnowledgeStore.getState().isFindOpen)
  }

  /** 写入当前笔记；路径一律读 store，避免 useEditor 闭包里的 activePath 过期 */
  async function insertPastedImage(file: File) {
    if (!useKnowledgeStore.getState().activePath) {
      toast.error(t('IMAGE_UPLOAD_NEED_FILE'))
      return
    }
    try {
      const relative = await uploadMarkdownImage(file)
      composerRef.current?.chain().focus().setImage({ src: relative }).run()
      toast.success(t('IMAGE_SAVED'))
    } catch (error) {
      console.error('[knowledge] paste image failed', error)
      toast.error(t('IMAGE_UPLOAD_FAILED'), {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  function insertPastedImages(files: File[]): boolean {
    if (files.length === 0) return false
    if (!useKnowledgeStore.getState().activePath) {
      toast.error(t('IMAGE_UPLOAD_NEED_FILE'))
      return true
    }
    for (const file of files) {
      void insertPastedImage(file)
    }
    return true
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
          const images = findClipboardImages(event.clipboardData)
          if (images.length > 0) return insertPastedImages(images)

          const plain = event.clipboardData?.getData('text/plain')?.trim() ?? ''
          const htmlClip = event.clipboardData?.getData('text/html')?.trim() ?? ''
          // 有文本时交给 TipTap；无文本时再试原生剪贴板（WebView 偶发不暴露 items）
          if (plain || htmlClip) return false

          void (async function () {
            const file = await findNativeClipboardImage()
            if (file) await insertPastedImage(file)
          })()
          return false
        },
        handleDrop(_view, event) {
          if (!event.dataTransfer) return false
          const handled = insertPastedImages(findClipboardImages(event.dataTransfer))
          if (handled) event.preventDefault()
          return handled
        }
      },
      onUpdate(props) {
        if (syncingRef.current) return
        const nextHtml = props.editor.getHTML()
        useKnowledgeStore.getState().toUpdateHtml(nextHtml)
        const matter = useKnowledgeStore.getState().frontMatter
        const md = serializeHtmlToMarkdown(nextHtml, matter)
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
    activePath,
    rootDir,
    viewMode,
    isDocLoading,
    isDirty,
    autosaveMs,
    markdown,
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

  const openPathRef = useRef(handleOpenPath)
  useLayoutEffect(function () {
    openPathRef.current = handleOpenPath
  })

  useEffect(
    function () {
      if (!composer) {
        rememberEditorBridge(null)
        return
      }
      rememberEditorBridge({
        findContext: function () {
          const { from, to } = composer.state.selection
          return {
            path: useKnowledgeStore.getState().activePath,
            content: composer.getText(),
            selection: from === to ? '' : composer.state.doc.textBetween(from, to, '\n')
          }
        },
        write: function (text) {
          const { from, to } = composer.state.selection
          if (from === to) {
            composer.chain().focus().insertContent(text).run()
            return
          }
          composer.chain().focus().insertContentAt({ from, to }, text).run()
        },
        openPath: function (path) {
          openPathRef.current(path)
        },
        jumpToPos: function (pos) {
          if (useKnowledgeStore.getState().viewMode === 'source') return
          composer.chain().focus().setTextSelection(pos).run()
          const dom = composer.view.domAtPos(pos)
          const element = (dom.node as HTMLElement).parentElement
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
      return function () {
        rememberEditorBridge(null)
      }
    },
    [composer]
  )

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

  function onDiscardPending() {
    setDiscardOpen(false)
    const action = pendingActionRef.current
    pendingActionRef.current = null
    useKnowledgeStore.getState().toMarkDirty(false)
    action?.()
  }

  function onSavePending() {
    void saveDocument({ liveHtml: composer?.getHTML() }).then(function (ok) {
      if (!ok) return
      setDiscardOpen(false)
      const action = pendingActionRef.current
      pendingActionRef.current = null
      action?.()
    })
  }

  function onExternalKeep() {
    useKnowledgeStore.getState().toSetExternalChanged(false)
  }

  function onExternalReload() {
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
  }

  function onSaveConflictKeep() {
    useKnowledgeStore.getState().toSetSaveConflict(false)
    void saveDocument({ liveHtml: composer?.getHTML(), force: true })
  }

  function onSaveConflictReload() {
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
  }

  return {
    composer,
    isSessionReady,
    hasOpened,
    isDocLoading,
    viewMode,
    markdown,
    activePath,
    isFocusMode,
    isFindOpen,
    fontSize,
    findPreferReplace,
    setFindPreferReplace,
    discardOpen,
    setDiscardOpen,
    externalChanged,
    saveConflict,
    exitFocusMode,
    toggleFindOpen,
    handleOpenFile,
    handleOpenFolder,
    handleNew,
    handleOpenPath,
    onSourceChange,
    onDiscardPending,
    onSavePending,
    onExternalKeep,
    onExternalReload,
    onSaveConflictKeep,
    onSaveConflictReload
  }
}

export { useKnowledgeWorkspace }
