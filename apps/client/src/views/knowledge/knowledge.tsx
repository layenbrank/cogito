import {
  Splitter,
  SplitterHandle,
  SplitterPane,
  usePaneRef
} from '@cogito/design/components/splitter'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useDockCommand } from '@/features/agent/dock/use-dock-command'
import { bootstrapClipInbox } from '@/features/knowledge-clip/clip-inbox.ts'
import { useShellSurface } from '@/features/window-shell/slots'
import { useSpacesStore } from '@/stores/spaces'
import { useKnowledgeStore } from '@/stores/knowledge'
import { KnowledgeCaptionBegin } from '@/views/knowledge/caption/begin.tsx'
import { KnowledgeCaptionFinal } from '@/views/knowledge/caption/final.tsx'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { bootstrapScheduledImport } from '@/views/knowledge/lib/scheduled-import.ts'
import { bootstrapKnowledgeSession } from '@/views/knowledge/lib/session.ts'
import { KnowledgeAside } from '@/views/knowledge/surface/aside.tsx'
import { KnowledgeSurface } from '@/views/knowledge/surface/index.tsx'
import { KnowledgeMainContent } from '@/views/knowledge/surface/main-content.tsx'
import {
  findLayoutVisibility,
  findRightPaneMode
} from '@/views/knowledge/surface/layout-visibility.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'
import { useKnowledgeDockScope } from '@/views/knowledge/workspace/dock-scope.ts'
import Summary from '@/views/knowledge/workspace/overlay/summary.tsx'
import styles from '@/views/knowledge/markdown.module.scss'

const SIDEBAR_ID = 'knowledge-sidebar'
const MAIN_ID = 'knowledge-main'
const ASIDE_ID = 'knowledge-aside'

/** 侧栏宽度：按语雀 / Obsidian 的手感给，够放标题、路径与类型分组 */
const SIDEBAR_SIZE = '300px'
const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 440

/** 右栏（大纲 / AI / 研究）宽度：默认 320px，可拖 */
const ASIDE_SIZE = '320px'
const ASIDE_MIN = 280
const ASIDE_MAX = '44%'

/** 主区最小宽度：正文优先，不允许被两侧挤成窄条 */
const MAIN_MIN = 480

/** 两栏宽度缓存（px）；旧的三栏百分比缓存已弃用 */
const SIDEBAR_KEY = 'knowledge.sidebar-width'
const ASIDE_KEY = 'knowledge.aside-width'
const ASIDE_WIDTH_MIN = 280
const ASIDE_WIDTH_MAX = 720

function readWidth(key: string, min: number, max: number): number | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const value = Number(raw)
    if (!Number.isFinite(value) || value < min || value > max) return null
    return Math.round(value)
  } catch (error) {
    console.warn('[knowledge] 读取栏宽失败:', key, error)
    return null
  }
}

function persistWidth(key: string, width: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(width)))
  } catch (error) {
    console.warn('[knowledge] 保存栏宽失败:', key, error)
  }
}

/**
 * 三栏：侧栏（空间 + 文档树） | 主区（编辑器 / 工具页） | 右栏（大纲 | AI | 研究）。
 *
 * 右栏是真正的 Splitter 列（默认收起，打开时 320px），主区最小 480px，
 * 侧栏可自定义宽度。学习类场景要边写边看大纲，抽屉会盖住正文。
 */
export default function Knowledge() {
  const location = useLocation()
  const [initialSidebarWidth] = useState(function () {
    return readWidth(SIDEBAR_KEY, SIDEBAR_MIN, SIDEBAR_MAX)
  })
  const [initialAsideWidth] = useState(function () {
    return readWidth(ASIDE_KEY, ASIDE_WIDTH_MIN, ASIDE_WIDTH_MAX)
  })
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
  const asideTab = useSurfaceStore(function (state) {
    return state.asideTab
  })
  const visibility = findLayoutVisibility(railTab)
  const showAside =
    findRightPaneMode({
      tab: railTab,
      asideTab,
      isAsideOpen,
      isFocusMode
    }) !== 'hidden'
  const sidebarRef = usePaneRef()
  const asideRef = usePaneRef()
  const openRef = useRef({ isSidebarOpen, isAsideOpen, isFocusMode })
  const ignoreSidebarResizeRef = useRef(false)
  const ignoreAsideResizeRef = useRef(false)

  useKnowledgeDockScope()
  useDockCommand()

  useEffect(
    function () {
      void bootstrapKnowledgeSession(location.search)
      void bootstrapClipInbox()
      useIngestQueueStore.getState().bootstrap()
      void useIngestQueueStore.getState().unblockReady()
      bootstrapScheduledImport(function () {
        const state = useSpacesStore.getState()
        const space = state.spaces.find(function (item) {
          return item.id === state.activeSpaceID
        })
        return space?.rootPath ?? null
      })
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
      const panel = sidebarRef.current
      if (!panel) return
      // 脚本里 expand/collapse 也会触发 onResize；不屏蔽就会反写偏好 → 根组件重渲染
      ignoreSidebarResizeRef.current = true
      if (!isFocusMode && isSidebarOpen) panel.expand()
      else panel.collapse()
      const timer = window.setTimeout(function () {
        ignoreSidebarResizeRef.current = false
      }, 50)
      return function () {
        window.clearTimeout(timer)
        ignoreSidebarResizeRef.current = false
      }
    },
    [isSidebarOpen, isFocusMode, sidebarRef]
  )

  useLayoutEffect(
    function () {
      const panel = asideRef.current
      if (!panel) return
      // 脚本里 expand/collapse 也会触发 onResize，得先屏蔽再打开
      ignoreAsideResizeRef.current = true
      if (showAside) {
        panel.expand()
        panel.resize(initialAsideWidth ? `${initialAsideWidth}px` : ASIDE_SIZE)
      } else {
        panel.collapse()
      }
      const timer = window.setTimeout(function () {
        ignoreAsideResizeRef.current = false
      }, 50)
      return function () {
        window.clearTimeout(timer)
        ignoreAsideResizeRef.current = false
      }
    },
    // 只随显隐变化 expand/collapse；切换 aside 页签不重 resize，避免误触发 onResize 关栏
    [showAside, initialAsideWidth, asideRef]
  )

  useEffect(
    function () {
      if (isFocusMode && isAsideOpen) {
        useSurfaceStore.getState().toCloseAside()
      }
    },
    [isFocusMode, isAsideOpen]
  )

  /** 拖动分隔条：折叠/展开同步偏好，宽度只记用户真拖过的值 */
  function handleSidebarResize() {
    if (ignoreSidebarResizeRef.current) return
    if (openRef.current.isFocusMode) return
    const panel = sidebarRef.current
    if (!panel) return
    if (panel.isCollapsed()) {
      if (openRef.current.isSidebarOpen) useKnowledgeStore.getState().toToggleSidebar()
      return
    }
    persistWidth(SIDEBAR_KEY, panel.findSize().inPixels)
    if (!openRef.current.isSidebarOpen) useKnowledgeStore.getState().toToggleSidebar()
  }

  function handleAsideResize() {
    if (ignoreAsideResizeRef.current) return
    if (openRef.current.isFocusMode) return
    const panel = asideRef.current
    if (!panel) return
    if (panel.isCollapsed()) {
      if (openRef.current.isAsideOpen) useSurfaceStore.getState().toCloseAside()
      return
    }
    persistWidth(ASIDE_KEY, panel.findSize().inPixels)
    if (!openRef.current.isAsideOpen) {
      useKnowledgeStore.getState().toPatchPreferences({ isOutlineOpen: true })
    }
  }

  const showSummary = !isFocusMode && visibility.showEditor

  // 槽位元素必须稳定：useShellSurface 每次渲染都会写槽，引用一变顶栏 / 底栏就重渲染
  const shellSlots = useMemo(
    function () {
      return {
        begin: <KnowledgeCaptionBegin />,
        final: <KnowledgeCaptionFinal />,
        section: showSummary ? <Summary /> : undefined,
        sectionClassName:
          'justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md',
        scrollable: false
      }
    },
    [showSummary]
  )

  useShellSurface(shellSlots)

  return (
    <div className={styles.workspace}>
      <Splitter
        id="knowledge-shell"
        orientation="horizontal"
        className="h-full min-h-0 w-full flex-1">
        <SplitterPane
          id={SIDEBAR_ID}
          paneRef={sidebarRef}
          defaultSize={initialSidebarWidth ? `${initialSidebarWidth}px` : SIDEBAR_SIZE}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          collapsible
          collapsedSize={0}
          preservePixel
          onResize={handleSidebarResize}
          className="border-border min-h-0 min-w-0 overflow-hidden border-r">
          <KnowledgeSurface />
        </SplitterPane>

        <SplitterHandle withHandle={!isFocusMode} />

        <SplitterPane
          id={MAIN_ID}
          min={MAIN_MIN}
          className="min-h-0 min-w-0 overflow-hidden">
          <KnowledgeMainContent tab={railTab} />
        </SplitterPane>

        <SplitterHandle withHandle={showAside && !isFocusMode} />

        <SplitterPane
          id={ASIDE_ID}
          paneRef={asideRef}
          defaultSize={initialAsideWidth ? `${initialAsideWidth}px` : ASIDE_SIZE}
          min={ASIDE_MIN}
          max={ASIDE_MAX}
          collapsible
          collapsedSize={0}
          preservePixel
          onResize={handleAsideResize}
          className="border-border min-h-0 min-w-0 overflow-hidden border-l">
          {showAside ? (
            <KnowledgeAside />
          ) : (
            <div
              className="bg-muted/20 h-full w-full"
              aria-hidden
            />
          )}
        </SplitterPane>
      </Splitter>
    </div>
  )
}
