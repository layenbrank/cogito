import type { Editor } from '@tiptap/react'
import { startTransition } from 'react'

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

import type { PendingAction } from '@/views/knowledge/workspace/use-knowledge-document-effects.ts'

type WorkspaceState = ReturnType<typeof useKnowledgeStore.getState>

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
    runGuarded(function () {
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

export { useKnowledgeFileActions }
