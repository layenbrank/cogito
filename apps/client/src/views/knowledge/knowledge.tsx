import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
} from '@cogito/design/components/resizable'
import { Suspense, lazy, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { Decorations } from '@/components/decorations/index.ts'
import { Fallback } from '@/components/fallback/index.ts'
import { useDockStore } from '@/features/agent/dock'
import { useDockCommand } from '@/features/agent/dock/use-dock-command'
import { useKnowledgeStore } from '@/stores/knowledge'
import { KnowledgeCaptionBegin } from '@/views/knowledge/caption/begin.tsx'
import { KnowledgeCaptionFinal } from '@/views/knowledge/caption/final.tsx'
import { bootstrapKnowledgeSession } from '@/views/knowledge/lib/session.ts'
import { KnowledgeAside } from '@/views/knowledge/surface/aside.tsx'
import { KnowledgeSurface } from '@/views/knowledge/surface/index.tsx'
import { useKnowledgeDockScope } from '@/views/knowledge/workspace/dock-scope.ts'
import Summary from '@/views/knowledge/workspace/overlay/summary.tsx'
import styles from '@/views/knowledge/markdown.module.scss'

const KnowledgeWorkspace = lazy(function () {
  return import('@/views/knowledge/workspace/markdown.tsx')
})

const LEFT_ID = 'knowledge-left'
const MAIN_ID = 'knowledge-main'
const RIGHT_ID = 'knowledge-right'

const LEFT_SIZE = '20%'
const LEFT_MIN = 180
const LEFT_MAX = '36%'

const RIGHT_SIZE = '22%'
const RIGHT_MIN = 240
const RIGHT_MAX = '40%'

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
 * Markdown 磁贴窗壳（最多三列，均可拖宽）：
 * - 左栏：浏览 / 库 / 待发布 / 任务 / 设置（tabs）
 * - 中栏：编辑器（源码|预览分栏只在中栏内部）
 * - 右栏：大纲 | AI（tabs；collapse 零宽仍挂载，会话不丢）
 */
export default function Knowledge() {
  const location = useLocation()
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const isSidebarOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const isAsideOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const leftRef = usePanelRef()
  const rightRef = usePanelRef()
  const openRef = useRef({ isSidebarOpen, isAsideOpen, isFocusMode })

  useKnowledgeDockScope()
  useDockCommand()

  // 壳一挂载就引导：不等 lazy 编辑器 chunk，尽早定根目录并恢复上次文件
  useEffect(
    function () {
      void bootstrapKnowledgeSession(location.search)
    },
    [location.search]
  )

  useEffect(
    function () {
      openRef.current = { isSidebarOpen, isAsideOpen, isFocusMode }
    },
    [isSidebarOpen, isAsideOpen, isFocusMode]
  )

  // 挂载后按存档开合一次
  useEffect(
    function () {
      const left = leftRef.current
      const right = rightRef.current
      if (!left || !right) return

      const open = openRef.current
      if (!open.isFocusMode && open.isSidebarOpen) left.expand()
      else left.collapse()

      if (!open.isFocusMode && open.isAsideOpen) {
        right.expand()
        if (right.getSize().inPixels < RIGHT_MIN) right.resize(RIGHT_SIZE)
      } else {
        right.collapse()
      }
    },
    [leftRef, rightRef]
  )

  useEffect(
    function () {
      const panel = leftRef.current
      if (!panel) return
      if (!isFocusMode && isSidebarOpen) panel.expand()
      else panel.collapse()
    },
    [isSidebarOpen, isFocusMode, leftRef]
  )

  useEffect(
    function () {
      const panel = rightRef.current
      if (!panel) return
      if (!isFocusMode && isAsideOpen) {
        if (panel.isCollapsed()) {
          panel.expand()
          if (panel.getSize().inPixels < RIGHT_MIN) panel.resize(RIGHT_SIZE)
        }
        return
      }
      panel.collapse()
    },
    [isAsideOpen, isFocusMode, rightRef]
  )

  function handleLeftResize() {
    if (openRef.current.isFocusMode) return
    const collapsed = leftRef.current?.isCollapsed() ?? false
    const nextOpen = !collapsed
    if (nextOpen === openRef.current.isSidebarOpen) return
    useKnowledgeStore.getState().toToggleSidebar()
  }

  function handleRightResize() {
    if (openRef.current.isFocusMode) return
    const collapsed = rightRef.current?.isCollapsed() ?? false
    const nextOpen = !collapsed
    if (nextOpen === openRef.current.isAsideOpen) return
    useKnowledgeStore.getState().toPatchPreferences({ isOutlineOpen: nextOpen })
    if (!nextOpen) useDockStore.getState().toClose()
  }

  return (
    <Decorations
      begin={<KnowledgeCaptionBegin />}
      final={<KnowledgeCaptionFinal />}
      section={isFocusMode ? undefined : <Summary />}
      sectionClassName="justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md"
      scrollable={false}>
      <div className={styles.workspace}>
        <ResizablePanelGroup
          id="knowledge-shell"
          orientation="horizontal"
          className="h-full min-h-0 w-full flex-1">
          <ResizablePanel
            id={LEFT_ID}
            panelRef={leftRef}
            defaultSize={LEFT_SIZE}
            minSize={LEFT_MIN}
            maxSize={LEFT_MAX}
            collapsible
            collapsedSize={0}
            collapsibleOnDrag={false}
            groupResizeBehavior="preserve-pixel-size"
            onResize={handleLeftResize}
            className="min-h-0 min-w-0 overflow-hidden border-r border-border">
            <KnowledgeSurface />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            id={MAIN_ID}
            minSize={280}
            className="min-h-0 min-w-0 overflow-hidden">
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

          <ResizableHandle withHandle />

          <ResizablePanel
            id={RIGHT_ID}
            panelRef={rightRef}
            defaultSize={RIGHT_SIZE}
            minSize={RIGHT_MIN}
            maxSize={RIGHT_MAX}
            collapsible
            collapsedSize={0}
            collapsibleOnDrag={false}
            groupResizeBehavior="preserve-pixel-size"
            onResize={handleRightResize}
            className="min-h-0 min-w-0 overflow-hidden border-l border-border">
            <KnowledgeAside />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Decorations>
  )
}
