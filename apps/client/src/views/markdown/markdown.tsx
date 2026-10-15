import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { Fallback } from '@/components/fallback/index.ts'
import { useMarkdownStore } from '@/stores/markdown'
import { MarkdownCaptionBegin } from '@/views/markdown/caption/begin.tsx'
import { MarkdownCaptionFinal } from '@/views/markdown/caption/final.tsx'
import Summary from '@/views/markdown/workspace/overlay/summary.tsx'
import styles from '@/views/markdown/markdown.module.scss'

const MarkdownWorkspace = lazy(function () {
  return import('@/views/markdown/workspace/markdown.tsx')
})

function MarkdownSkeleton() {
  return (
    <div className="flex h-full min-h-0 animate-pulse flex-col gap-2 p-3">
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="w-40 rounded-md bg-muted" />
        <div className="flex-1 rounded-md bg-muted" />
        <div className="w-32 rounded-md bg-muted" />
      </div>
    </div>
  )
}

/**
 * Markdown 磁贴窗壳：
 * - begin：窗口标题
 * - final：布局开关（侧栏/大纲，对齐 VS Code）+ 应用菜单
 * - section：状态栏
 * - children：工作区（Utility / 侧栏 / 编辑器 / 大纲）
 */
export default function Markdown() {
  const isFocusMode = useMarkdownStore(function (state) {
    return state.isFocusMode
  })

  return (
    <Decorations
      begin={<MarkdownCaptionBegin />}
      final={<MarkdownCaptionFinal />}
      section={isFocusMode ? undefined : <Summary />}
      sectionClassName="justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md"
      scrollable={false}>
      <div className={styles.workspace}>
        <Fallback.ErrorBoundary
          title="Markdown 编辑器出现问题"
          subTitle="编辑器遇到意外错误。可重试恢复，或刷新页面。">
          <Suspense fallback={<MarkdownSkeleton />}>
            <MarkdownWorkspace />
          </Suspense>
        </Fallback.ErrorBoundary>
      </div>
    </Decorations>
  )
}
