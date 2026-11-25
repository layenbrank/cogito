import type { Editor } from '@tiptap/react'
import { startTransition, useEffect, useRef } from 'react'

import { useKnowledgeStore } from '@/stores/knowledge'
import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'
import {
  makeUntitled,
  openFolderAsWorkspace,
  openPath,
  openWithDialog,
  saveDocument,
  syncDerived
} from '@/views/knowledge/lib/session.ts'
import { commitWikiReveal } from '@/views/knowledge/workspace/editor-context.ts'

import type { PendingAction } from '@/views/knowledge/workspace/use-knowledge-document-effects.ts'

type WorkspaceState = ReturnType<typeof useKnowledgeStore.getState>

/**
 * 源码模式派生（HTML 预览 / 大纲 / 统计）的合并窗口。
 *
 * 源码框本身必须同步写 `markdown`（受控输入），但 `marked.parse` + frontmatter +
 * 大纲/统计都是全文档级操作，逐键跑会让长文档在源码模式里同样卡顿。
 */
const SOURCE_DERIVE_DELAY_MS = 300

interface KnowledgeFileActionsInput {
  composer: Editor | null
  composerRef: { current: Editor | null }
  syncingRef: { current: boolean }
  pendingActionRef: { current: PendingAction }
  frontMatter: WorkspaceState['frontMatter']
  isDirty: boolean
  toUpdateMarkdown: WorkspaceState['toUpdateMarkdown']
  toUpdateHtml: WorkspaceState['toUpdateHtml']
  setDiscardOpen: (value: boolean) => void
}

/** 打开 / 新建 / 保存 与源码⇄实时的文档动作 */
function useKnowledgeFileActions(input: KnowledgeFileActionsInput) {
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

  /** 源码模式派生状态的合并窗口 */
  const sourceTimerRef = useRef<number | null>(null)

  useEffect(function () {
    return function () {
      if (sourceTimerRef.current !== null) {
        window.clearTimeout(sourceTimerRef.current)
        sourceTimerRef.current = null
      }
    }
  }, [])

  function runGuarded(action: () => void) {
    if (!isDirty) {
      action()
      return
    }
    pendingActionRef.current = action
    setDiscardOpen(true)
  }

  function syncComposerFromStore(expectedPath?: string | null) {
    if (!composer) return
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
          syncComposerFromStore(useKnowledgeStore.getState().activePath)
        }
      })
    })
  }

  function handleOpenFolder() {
    runGuarded(function () {
      void openFolderAsWorkspace().then(function (ok) {
        if (ok && !useKnowledgeStore.getState().activePath) {
          syncComposerFromStore()
        }
      })
    })
  }

  function handleNew() {
    runGuarded(function () {
      makeUntitled()
      if (composer) {
        syncingRef.current = true
        composer.commands.setContent('<p></p>', { emitUpdate: false })
        syncingRef.current = false
      }
    })
  }

  function handleOpenPath(path: string) {
    // 脏确认通过后再切 Wiki + 记 previewReturn；取消则不动 tab
    runGuarded(function () {
      commitWikiReveal()
      void openPath(path).then(function (ok) {
        if (ok) syncComposerFromStore(path)
      })
    })
  }

  async function handleSave() {
    await saveDocument({ liveHtml: composer?.getHTML() })
  }

  function onSourceChange(value: string) {
    if (syncingRef.current) return
    // 源码框是受控输入：markdown 必须同步写入，否则光标/输入会回退
    toUpdateMarkdown(value)
    if (sourceTimerRef.current !== null) window.clearTimeout(sourceTimerRef.current)
    sourceTimerRef.current = window.setTimeout(function () {
      sourceTimerRef.current = null
      // 用最新值重算：节流窗口内可能又敲了几个字
      const latest = useKnowledgeStore.getState().markdown
      syncDerived(latest)
      toUpdateHtml(parseMarkdown(latest).html)
    }, SOURCE_DERIVE_DELAY_MS)
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

export { useKnowledgeFileActions }
