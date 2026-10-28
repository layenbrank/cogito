import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import { clsx } from 'clsx'
import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { Fallback } from '@/components/fallback/index.ts'
import { useDockCommand } from '@/features/agent/dock/use-dock-command'
import { useKnowledgeStore } from '@/stores/knowledge'
import { KnowledgeCaptionBegin } from '@/views/knowledge/caption/begin.tsx'
import { KnowledgeCaptionFinal } from '@/views/knowledge/caption/final.tsx'
import { KnowledgeAside } from '@/views/knowledge/surface/aside.tsx'
import { KnowledgeSurface } from '@/views/knowledge/surface/index.tsx'
import { useKnowledgeDockScope } from '@/views/knowledge/workspace/dock-scope.ts'
import Summary from '@/views/knowledge/workspace/overlay/summary.tsx'
import styles from '@/views/knowledge/markdown.module.scss'

const KnowledgeWorkspace = lazy(function () {
  return import('@/views/knowledge/workspace/markdown.tsx')
})

function KnowledgeSkeleton() {
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
 * Markdown 磁贴窗壳（最多三列）：
 * - 左栏：浏览 / 库 / 待发布 / 任务 / 设置（tabs）
 * - 中栏：编辑器（源码|预览分栏只在中栏内部）
 * - 右栏：大纲 | AI（tabs，互斥；收起零宽仍挂载，会话不丢）
 *
 * begin：窗口标题；final：布局开关；section：状态栏。
 */
export default function Knowledge() {
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const isSidebarOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const isAsideOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  // 对话坞的 scope 跟着窗口走：切磁贴就解绑，不会串上下文
  useKnowledgeDockScope()
  // mod+j 开关对话坞（命令面板里也能搜到）
  useDockCommand()

  const showsLeft = !isFocusMode && isSidebarOpen
  const showsRight = !isFocusMode && isAsideOpen

  return (
    <Decorations
      begin={<KnowledgeCaptionBegin />}
      final={<KnowledgeCaptionFinal />}
      section={isFocusMode ? undefined : <Summary />}
      sectionClassName="justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md"
      scrollable={false}>
      <div className={styles.workspace}>
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full min-h-0 min-w-0 flex-1">
          {showsLeft ? (
            <>
              <ResizablePanel
                defaultSize="22%"
                minSize="14%"
                maxSize="36%"
                className="min-h-0 min-w-0 overflow-hidden border-r border-border">
                <KnowledgeSurface />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          ) : null}

          <ResizablePanel className="min-h-0 min-w-0 overflow-hidden">
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
              <Fallback.ErrorBoundary
                title="Markdown 编辑器出现问题"
                subTitle="编辑器遇到意外错误。可重试恢复，或刷新页面。">
                <Suspense fallback={<KnowledgeSkeleton />}>
                  <KnowledgeWorkspace />
                </Suspense>
              </Fallback.ErrorBoundary>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {!isFocusMode ? (
          <div
            aria-hidden={!showsRight}
            className={clsx(
              'flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-background transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none',
              showsRight ? 'w-80 border-l border-border opacity-100' : 'pointer-events-none w-0 opacity-0'
            )}>
            <KnowledgeAside />
          </div>
        ) : null}
      </div>
    </Decorations>
  )
}
