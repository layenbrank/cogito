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
import { normalizeCopiedText, toCopiedHtml } from '@/views/knowledge/lib/copy-text.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'
import { findOutlineFromEditor } from '@/views/knowledge/lib/outline.ts'
import {
  openPath,
  saveDocument,
  setLiveHtmlReader
} from '@/views/knowledge/lib/session.ts'
import { findDocStats } from '@/views/knowledge/lib/stats.ts'
import { t } from '@/views/knowledge/locale.ts'
import { rememberEditorBridge } from '@/views/knowledge/workspace/editor-context.ts'
import { findMarkdownExtensions } from '@/views/knowledge/workspace/extensions.ts'
import { useKnowledgeCommands } from '@/views/knowledge/workspace/use-knowledge-commands.ts'
import {
  useKnowledgeDocumentEffects,
  type PendingAction
} from '@/views/knowledge/workspace/use-knowledge-document-effects.ts'
import { useKnowledgeFileActions } from '@/views/knowledge/workspace/use-knowledge-file-actions.ts'
import {
  isExternalHref,
  openExternalLink,
  openWikiLink
} from '@/views/knowledge/workspace/link-navigation.ts'

/**
 * 派生状态（HTML / Markdown / 大纲 / 统计）的合并窗口。
 *
 * 这四样都是**全文档级**操作：`getHTML()` 要序列化整棵 DOM，`serializeHtmlToMarkdown`
 * 要跑完整 turndown 管线，大纲要遍历全部节点。逐键执行时，几百 KB 的页面单次就要
 * 几十到几百毫秒，叠加右侧大纲 / 标题 / 底栏的重渲染，长任务实测能到 1.2–1.5s。
 *
 * 因此：按键只同步置「脏」标记（O(1)），派生状态 300ms 合并一次；保存、切模式、
 * 取上下文时读编辑器本体（`setLiveHtmlReader`），不依赖这份节流快照。
 */
const DERIVE_DELAY_MS = 300

function useKnowledgeWorkspace() {
  const composerRef = useRef<Editor | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [findPreferReplace, setFindPreferReplace] = useState(false)
  const pendingActionRef = useRef<PendingAction>(null)
  const syncingRef = useRef(false)
  const lastSavedRef = useRef('')
  /** 派生状态的合并窗口（见 DERIVE_DELAY_MS） */
  const deriveTimerRef = useRef<number | null>(null)

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
        handleDOMEvents: {
          click(_view, event) {
            const target = event.target
            if (!(target instanceof HTMLElement)) return false
            const anchor = target.closest('a')
            if (!(anchor instanceof HTMLAnchorElement)) return false
            if (anchor.hasAttribute('data-wikilink')) {
              event.preventDefault()
              openWikiLink(anchor.getAttribute('data-wikilink-title') ?? '')
              return true
            }
            const href = anchor.getAttribute('href') ?? ''
            // 图片是 `img`，走到这里的都是文本链接：外链交给系统浏览器，其余（相对路径/锚点）不接管
            if (!isExternalHref(href)) return false
            event.preventDefault()
            void openExternalLink(href)
            return true
          },
          copy(view, event) {
            if (!(event instanceof ClipboardEvent)) return false
            const { from, to, empty } = view.state.selection
            if (empty) return false
            const data = event.clipboardData
            if (!data) return false
            const text = normalizeCopiedText(view.state.doc.textBetween(from, to, '\n', '\n'))
            data.setData('text/plain', text)
            data.setData('text/html', toCopiedHtml(text))
            event.preventDefault()
            return true
          }
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
      onUpdate() {
        if (syncingRef.current) return
        // 只同步置脏 + 推进编辑代数（标量）：窗口标题 / 关闭拦截 / 保存判定立刻生效
        useKnowledgeStore.getState().toTouchEdit()
        const pathAtSchedule = useKnowledgeStore.getState().activePath
        if (deriveTimerRef.current !== null) window.clearTimeout(deriveTimerRef.current)
        deriveTimerRef.current = window.setTimeout(function () {
          deriveTimerRef.current = null
          if (syncingRef.current) return
          // 期间切了文档：这份派生属于上一篇，丢掉（否则会把旧文档的大纲写到新文档上）
          if (useKnowledgeStore.getState().activePath !== pathAtSchedule) return
          const editor = composerRef.current
          if (!editor) return
          const nextHtml = editor.getHTML()
          const md = serializeHtmlToMarkdown(
            nextHtml,
            useKnowledgeStore.getState().frontMatter
          )
          // 一次 setter 落地：逐个动作写会把标题 / 大纲 / 底栏各重渲染 4~5 轮
          const state = useKnowledgeStore.getState()
          state.toCommitEdit({
            html: nextHtml,
            markdown: md,
            outline: findOutlineFromEditor(editor)
          })
          state.toUpdateStats(findDocStats(md))
        }, DERIVE_DELAY_MS)
      }
    },
    [isTypographyEnabled]
  )

  // 保存路径不依赖节流快照：`saveDocument()` 不带 liveHtml 时直接读编辑器本体
  useEffect(
    function () {
      setLiveHtmlReader(function () {
        return composerRef.current?.getHTML() ?? null
      })
      return function () {
        setLiveHtmlReader(null)
      }
    },
    []
  )

  // 换了文档 / 组件卸载时丢掉还没落地的派生，避免把上一篇的大纲与统计写到新文档上
  useEffect(
    function () {
      return function () {
        if (deriveTimerRef.current !== null) {
          window.clearTimeout(deriveTimerRef.current)
          deriveTimerRef.current = null
        }
      }
    },
    [activePath]
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
