/**
 * Git 差异视图。
 *
 * 小改动：Monaco DiffEditor（宽屏并排 / 窄屏 inline，对齐 VS Code 900px 断点）。
 * 大重写：结构化 hunk 列表；宽屏双列、窄屏统一视图。
 */
import { cn } from 'cn'
import { useRef } from 'react'

import { useCodeGitStore } from '@/stores/code-git'
import {
  findModeHint,
  onCloseDiffTab,
  onOpenInEditor
} from '@/views/code/workspace/diff-host-actions.ts'
import { DiffHostContent, DiffHostToolbar } from '@/views/code/workspace/diff-host-chrome.tsx'
import { useContainerLayout } from '@/views/code/workspace/diff-host-layout.ts'
import { useDiffMonacoEditor } from '@/views/code/workspace/use-diff-monaco-editor.ts'

function DiffHost(props: { isOpen: boolean }) {
  const sideHostRef = useRef<HTMLDivElement>(null)
  const { hostRef: contentRef, layout } = useContainerLayout(props.isOpen)
  const isSideBySide = layout === 'sideBySide'
  const diff = useCodeGitStore(function (state) {
    return state.diff
  })

  useDiffMonacoEditor({
    sideHostRef,
    isOpen: props.isOpen,
    isSideBySide
  })

  const isLoading = Boolean(diff?.isLoading)
  const isHunks = diff?.mode === 'hunks'
  const title = diff?.relative ?? ''
  const modeHint = diff ? findModeHint(diff, layout) : ''
  const hideMonaco = isHunks || isLoading || Boolean(diff?.isBinary) || Boolean(diff?.isIdentical)

  return (
    <div
      className={cn(
        'bg-background absolute inset-0 z-10 flex flex-col',
        !props.isOpen && 'hidden'
      )}
      aria-hidden={!props.isOpen}>
      <DiffHostToolbar
        title={title}
        modeHint={modeHint}
        isLoading={!diff || isLoading}
        onOpenInEditor={onOpenInEditor}
        onCloseDiffTab={onCloseDiffTab}
      />
      <DiffHostContent
        isOpen={props.isOpen}
        contentRef={contentRef}
        sideHostRef={sideHostRef}
        layout={layout}
        isHunks={isHunks}
        isLoading={isLoading}
        hideMonaco={hideMonaco}
        diff={diff}
      />
    </div>
  )
}

export { DiffHost }
