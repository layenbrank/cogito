import {
  Splitter,
  SplitterHandle,
  SplitterPane,
  usePaneRef
} from '@cogito/design/components/splitter'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { useShellSurface } from '@/features/window-shell/slots'
import { useDockStore } from '@/features/agent/dock'
import { useDockCommand } from '@/features/agent/dock/use-dock-command'
import { bootstrapClipInbox } from '@/features/knowledge-clip/clip-inbox.ts'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { KnowledgeCaptionBegin } from '@/views/knowledge/caption/begin.tsx'
import { KnowledgeCaptionFinal } from '@/views/knowledge/caption/final.tsx'
import { analyzeWithAcp } from '@/views/knowledge/lib/ingest-acp-analyzer.ts'
import { registerIngestAnalyzer } from '@/views/knowledge/lib/ingest-analyze.ts'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { bootstrapScheduledImport } from '@/views/knowledge/lib/scheduled-import.ts'
import { bootstrapKnowledgeSession } from '@/views/knowledge/lib/session.ts'
import { KnowledgeAside } from '@/views/knowledge/surface/aside.tsx'
import { KnowledgeSurface } from '@/views/knowledge/surface/index.tsx'
import { KnowledgeMainContent } from '@/views/knowledge/surface/main-content.tsx'
import { findLayoutVisibility } from '@/views/knowledge/surface/layout-visibility.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'
import { useKnowledgeDockScope } from '@/views/knowledge/workspace/dock-scope.ts'
import Summary from '@/views/knowledge/workspace/overlay/summary.tsx'
import styles from '@/views/knowledge/markdown.module.scss'

const LEFT_ID = 'knowledge-left'
const MAIN_ID = 'knowledge-main'
const RIGHT_ID = 'knowledge-right'

const LEFT_SIZE = '22%'
const LEFT_MIN = 200
const LEFT_MAX = '38%'
/** 设置全页时左栏只留 icon rail */
const LEFT_RAIL_ONLY = 48

const RIGHT_SIZE = '22%'
const RIGHT_MIN = 240
const RIGHT_MAX = '40%'

/**
 * 对齐 llm_wiki 三列壳（主题 / 组件用本仓库）：
 * - 左：Icon rail +（Knowledge|Files + Activity）
 * - 中：Wiki 编辑器 / 工具主视图 / 设置
 * - 右：大纲 | AI（ACP）
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
  const railTab = useSurfaceStore(function (state) {
    return state.tab
  })
  const visibility = findLayoutVisibility(railTab)
  const isSettingsView = visibility.isRailOnly
  const leftRef = usePaneRef()
  const rightRef = usePaneRef()
  const openRef = useRef({ isSidebarOpen, isAsideOpen, isFocusMode })

  useKnowledgeDockScope()
  useDockCommand()

  useEffect(
    function () {
      registerIngestAnalyzer(analyzeWithAcp)
      void bootstrapKnowledgeSession(location.search)
      void bootstrapClipInbox()
      useIngestQueueStore.getState().bootstrap()
      void useIngestQueueStore.getState().unblockReady()
      bootstrapScheduledImport(function () {
        const state = useKnowledgeBaseStore.getState()
        const base = state.bases.find(function (item) {
          return item.id === state.activeBaseID
        })
        return base?.rootPath ?? null
      })
      return function () {
        registerIngestAnalyzer(null)
      }
    },
    [location.search]
  )

  useEffect(
    function () {
      openRef.current = { isSidebarOpen, isAsideOpen, isFocusMode }
    },
    [isSidebarOpen, isAsideOpen, isFocusMode]
  )

  useEffect(
    function () {
      const left = leftRef.current
      const right = rightRef.current
      if (!left || !right) return

      const open = openRef.current
      if (!open.isFocusMode && open.isSidebarOpen) left.expand()
      else left.collapse()

      if (!open.isFocusMode && open.isAsideOpen && !isSettingsView) {
        right.expand()
        if (right.findSize().inPixels < RIGHT_MIN) right.resize(RIGHT_SIZE)
      } else {
        right.collapse()
      }
    },
    [leftRef, rightRef, isSettingsView]
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
      if (isSettingsView || isFocusMode || !isAsideOpen || !visibility.showEditor) {
        panel.collapse()
        return
      }
      if (panel.isCollapsed()) {
        panel.expand()
        if (panel.findSize().inPixels < RIGHT_MIN) panel.resize(RIGHT_SIZE)
      }
    },
    [isAsideOpen, isFocusMode, isSettingsView, visibility.showEditor, rightRef]
  )

  useEffect(
    function () {
      const left = leftRef.current
      if (!left) return
      if (isSettingsView) {
        if (!useKnowledgeStore.getState().isSidebarOpen) {
          useKnowledgeStore.getState().toToggleSidebar()
        }
        if (left.isCollapsed()) left.expand()
        left.resize(LEFT_RAIL_ONLY)
        return
      }
      if (isFocusMode || !isSidebarOpen) return
      if (left.isCollapsed()) left.expand()
      if (left.findSize().inPixels <= LEFT_RAIL_ONLY + 16) {
        left.resize(LEFT_SIZE)
      }
    },
    [isSettingsView, isFocusMode, isSidebarOpen, leftRef]
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

  useShellSurface({
    begin: <KnowledgeCaptionBegin />,
    final: <KnowledgeCaptionFinal />,
    section: isFocusMode || !visibility.showEditor ? undefined : <Summary />,
    sectionClassName:
      'justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md',
    scrollable: false
  })

  return (
    <div className={styles.workspace}>
      <Splitter
        id="knowledge-shell"
        orientation="horizontal"
        className="h-full min-h-0 w-full flex-1">
        <SplitterPane
          id={LEFT_ID}
          paneRef={leftRef}
          defaultSize={LEFT_SIZE}
          min={isSettingsView ? LEFT_RAIL_ONLY : LEFT_MIN}
          max={isSettingsView ? LEFT_RAIL_ONLY : LEFT_MAX}
          collapsible
          collapsedSize={0}
          preservePixel
          onResize={handleLeftResize}
          className="min-h-0 min-w-0 overflow-hidden border-r border-border">
          <KnowledgeSurface />
        </SplitterPane>

        <SplitterHandle withHandle={!isSettingsView} />

        <SplitterPane
          id={MAIN_ID}
          min={280}
          className="min-h-0 min-w-0 overflow-hidden">
          <KnowledgeMainContent tab={railTab} />
        </SplitterPane>

        <SplitterHandle withHandle={visibility.showEditor && !isSettingsView} />

        <SplitterPane
          id={RIGHT_ID}
          paneRef={rightRef}
          defaultSize={RIGHT_SIZE}
          min={RIGHT_MIN}
          max={RIGHT_MAX}
          collapsible
          collapsedSize={0}
          preservePixel
          onResize={handleRightResize}
          className="min-h-0 min-w-0 overflow-hidden border-l border-border">
          <KnowledgeAside />
        </SplitterPane>
      </Splitter>
    </div>
  )
}
