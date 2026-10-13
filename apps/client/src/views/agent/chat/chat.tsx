/**
 * Agent 聊天子页：标题栏 + 三栏（工作区 | 主对话 | 右栏骨架）。
 *
 * 主对话走 assistant-ui `Thread`；右栏空/忙两种骨架（Qoder）；
 * Head 双侧 panel 图标控制开合并持久化。
 */
import { useAuiState } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@i-thinking/design/assistant/labels'
import { Thread } from '@i-thinking/design/assistant/thread.aui'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
} from '@i-thinking/design/components/resizable'
import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AgentAside } from '@/views/agent/chat/components/aside'
import { ComposerActions } from '@/views/agent/chat/components/composer-actions'
import { ComposerEnd } from '@/views/agent/chat/components/composer-end'
import { ComposerFooter } from '@/views/agent/chat/components/composer-footer'
import { ComposerTriggers } from '@/views/agent/chat/components/composer-triggers'
import { DelegatePanel } from '@/views/agent/chat/components/delegate-panel'
import { AgentHead } from '@/views/agent/chat/components/head'
import { AgentSidebar } from '@/views/agent/chat/components/sidebar'
import {
  findSplitterLayout,
  findSplitterOpen,
  MAIN_ID,
  PLAN_ID,
  PLAN_MAX,
  PLAN_MIN,
  PLAN_SIZE,
  SESSION_ID,
  SESSION_MAX,
  SESSION_MIN,
  SESSION_SIZE,
  WORKBENCH_MIN,
  writeSplitterLayout,
  writeSplitterOpen,
  type SplitterLayout
} from '@/views/agent/chat/components/splitter-sizes'
import { AgentProcessFold, AgentProcessGroup } from '@/views/agent/chat/components/process-group'
import { ThreadWelcome } from '@/views/agent/chat/components/thread-welcome'
import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'
import { AgentRuntimeProvider } from '@/views/agent/chat/runtime'
import { AgentTitlebar } from '@/views/agent/components/titlebar'
import { findLatestPlan } from '@/features/agent/plan'
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { useAgentStore } from '@/stores/agent.ts'
import { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/chat/chat.module.scss'

/**
 * plan 到达时自动展开右栏（不覆盖用户手动收起：同线程同总量只顶一次）。
 */
function usePlanAutoOpen(isAsideOpen: boolean, openAside: () => void) {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const plan = useMemo(function () {
    return findLatestPlan(messages)
  }, [messages])
  const openedFor = useRef<{ threadID: string; total: number } | null>(null)

  useEffect(
    function () {
      if (!plan || plan.total === 0) return
      const opened = openedFor.current
      if (opened?.threadID === threadID && opened.total === plan.total) return
      openedFor.current = { threadID, total: plan.total }
      if (!isAsideOpen) openAside()
    },
    [plan, threadID, isAsideOpen, openAside]
  )

  return plan
}

function AgentChat() {
  return (
    <AgentRuntimeProvider>
      <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
        <AgentChatLayout />
      </AssistantLabelsProvider>
    </AgentRuntimeProvider>
  )
}

function AgentChatLayout() {
  const navigate = useNavigate()
  const [defaultLayout] = useState(findSplitterLayout)
  const [openState] = useState(findSplitterOpen)
  const [isSidebarOpen, updateSidebarOpen] = useState(openState.isSidebarOpen)
  const [isAsideOpen, updateAsideOpen] = useState(openState.isAsideOpen)
  const [isSearchOpen, updateSearchOpen] = useState(false)
  const [scenario, updateScenario] = useState<ScenarioKey>('general')
  const sidebarRef = usePanelRef()
  const asideRef = usePanelRef()
  const openRef = useRef({ isSidebarOpen, isAsideOpen })

  useEffect(
    function () {
      openRef.current = { isSidebarOpen, isAsideOpen }
    },
    [isSidebarOpen, isAsideOpen]
  )

  function openAside() {
    updateAsideOpen(true)
    writeSplitterOpen({
      isSidebarOpen: openRef.current.isSidebarOpen,
      isAsideOpen: true
    })
  }

  const plan = usePlanAutoOpen(isAsideOpen, openAside)

  useEffect(function () {
    void useAgentStore.getState().toReadWorkspaces()
    void useAgentStore.getState().toReadWorkspaceFolders()
    void useAgentStore.getState().toReadSessions()
    void useProviderStore.getState().toReadProviders()
  }, [])

  useEffect(
    function () {
      const sidebar = sidebarRef.current
      const aside = asideRef.current
      if (!sidebar || !aside) return
      if (openRef.current.isSidebarOpen) sidebar.expand()
      else sidebar.collapse()
      if (openRef.current.isAsideOpen) {
        aside.expand()
        if (aside.getSize().inPixels < PLAN_MIN) aside.resize(PLAN_SIZE)
      } else {
        aside.collapse()
      }
    },
    [sidebarRef, asideRef]
  )

  useEffect(
    function () {
      const panel = sidebarRef.current
      if (!panel) return
      if (isSidebarOpen) panel.expand()
      else panel.collapse()
    },
    [isSidebarOpen, sidebarRef]
  )

  useEffect(
    function () {
      const panel = asideRef.current
      if (!panel) return
      if (isAsideOpen) {
        if (panel.isCollapsed()) {
          panel.expand()
          if (panel.getSize().inPixels < PLAN_MIN) panel.resize(PLAN_SIZE)
        }
        return
      }
      panel.collapse()
    },
    [isAsideOpen, asideRef]
  )

  function persistOpen(next: { isSidebarOpen: boolean; isAsideOpen: boolean }) {
    writeSplitterOpen(next)
  }

  function handleLayoutChanged(layout: SplitterLayout) {
    writeSplitterLayout(layout)
  }

  function handleSidebarResize() {
    const collapsed = sidebarRef.current?.isCollapsed() ?? false
    const nextOpen = !collapsed
    if (nextOpen === openRef.current.isSidebarOpen) return
    updateSidebarOpen(nextOpen)
    persistOpen({ isSidebarOpen: nextOpen, isAsideOpen: openRef.current.isAsideOpen })
  }

  function handleAsideResize() {
    const collapsed = asideRef.current?.isCollapsed() ?? false
    const nextOpen = !collapsed
    if (nextOpen === openRef.current.isAsideOpen) return
    updateAsideOpen(nextOpen)
    persistOpen({ isSidebarOpen: openRef.current.isSidebarOpen, isAsideOpen: nextOpen })
  }

  function openSettings(section?: string) {
    void navigate(section ? `/agent/settings?section=${section}` : '/agent/settings')
  }

  return (
    <div className={clsx(styles.chat)}>
      <AgentTitlebar
        className={styles.titlebar}
        actions={<DelegatePanel />}
      />
      <div className={styles.body}>
        <ResizablePanelGroup
          id="agent-workbench"
          orientation="horizontal"
          className={styles.splitter}
          defaultLayout={defaultLayout}
          onLayoutChanged={handleLayoutChanged}>
          <ResizablePanel
            id={SESSION_ID}
            panelRef={sidebarRef}
            defaultSize={SESSION_SIZE}
            minSize={SESSION_MIN}
            maxSize={SESSION_MAX}
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
            onResize={handleSidebarResize}>
            <AgentSidebar
              className={styles.sidebar}
              scenario={scenario}
              isSearchOpen={isSearchOpen}
              onScenarioChange={updateScenario}
              onSearchOpenChange={updateSearchOpen}
              onOpenSettings={openSettings}
            />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel
            id={MAIN_ID}
            minSize={WORKBENCH_MIN}>
            <div className={clsx(styles.workbench, styles.thread)}>
              <AgentHead
                isSidebarOpen={isSidebarOpen}
                isAsideOpen={isAsideOpen}
                onToggleSidebar={function () {
                  const next = !openRef.current.isSidebarOpen
                  updateSidebarOpen(next)
                  persistOpen({
                    isSidebarOpen: next,
                    isAsideOpen: openRef.current.isAsideOpen
                  })
                }}
                onToggleAside={function () {
                  const next = !openRef.current.isAsideOpen
                  updateAsideOpen(next)
                  persistOpen({
                    isSidebarOpen: openRef.current.isSidebarOpen,
                    isAsideOpen: next
                  })
                }}
              />
              <main className={styles.threadMain}>
                <Thread
                  components={{
                    Welcome: ThreadWelcome,
                    ReasoningGroup: AgentProcessGroup,
                    ProcessGroup: AgentProcessFold,
                    ComposerStart: ComposerActions,
                    ComposerAttach: null,
                    ComposerEnd: ComposerEnd,
                    ComposerFooter: ComposerFooter,
                    ComposerTriggers: ComposerTriggers
                  }}
                />
              </main>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel
            id={PLAN_ID}
            panelRef={asideRef}
            defaultSize={PLAN_SIZE}
            minSize={PLAN_MIN}
            maxSize={PLAN_MAX}
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
            onResize={handleAsideResize}>
            <AgentAside
              className={styles.planPane}
              plan={plan}
              onClose={function () {
                updateAsideOpen(false)
                persistOpen({
                  isSidebarOpen: openRef.current.isSidebarOpen,
                  isAsideOpen: false
                })
              }}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

export default AgentChat
