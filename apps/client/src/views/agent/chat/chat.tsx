/**
 * Agent 聊天子页：标题栏 + 三栏（工作区 | 主对话 | Plan）。
 *
 * 是 `/agent` 的默认子页（`/agent` 会重定向过来）；模型接入不在这里弹窗，走
 * `/agent/settings`（见 `views/agent/settings/`）。
 *
 * 主对话栏走 assistant-ui 的 `Thread`（一条通路）；右栏读当前线程的最新 `plan` 部件
 * （goose 的结构化计划），有内容时自动展开。
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

import { ComposerModelEnd } from '@/views/agent/chat/components/composer-model-end'
import { AgentPlanPane } from '@/views/agent/chat/components/plan-pane'
import { AgentSidebar } from '@/views/agent/chat/components/sidebar'
import {
  findSplitterLayout,
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
  type SplitterLayout
} from '@/views/agent/chat/components/splitter-sizes'
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
 * 有内容时自动展开右栏（对齐 Qoder plan 场景）。
 *
 * 按「计划总量」记一次已开（键带线程 id）：计划条目更新（总量变化）才再开一次 ——
 * 用户手动收起后不会被同一次计划反复顶开，也不会被上一个会话的计划顶掉这一次。
 */
function usePlanAside() {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const plan = useMemo(function () {
    return findLatestPlan(messages)
  }, [messages])
  const [isOpen, updateOpen] = useState(false)
  const openedFor = useRef<{ threadID: string; total: number } | null>(null)
  const planRef = usePanelRef()

  useEffect(
    function () {
      if (!plan || plan.total === 0) return
      const opened = openedFor.current
      if (opened?.threadID === threadID && opened.total === plan.total) return
      openedFor.current = { threadID, total: plan.total }
      updateOpen(true)
    },
    [plan, threadID]
  )

  return { plan, isOpen, updateOpen, planRef }
}

function AgentChat() {
  const navigate = useNavigate()
  const [defaultLayout] = useState(findSplitterLayout)
  const [isSearchOpen, updateSearchOpen] = useState(false)
  const [scenario, updateScenario] = useState<ScenarioKey>('general')
  const { plan, isOpen, updateOpen, planRef } = usePlanAside()

  useEffect(function () {
    void useAgentStore.getState().toReadWorkspaces()
    void useAgentStore.getState().toReadWorkspaceFolders()
    void useAgentStore.getState().toReadSessions()
    void useProviderStore.getState().toReadProviders()
  }, [])

  // 右栏开合跟着 open 状态走
  useEffect(
    function () {
      const panel = planRef.current
      if (!panel) return
      if (isOpen) {
        if (panel.isCollapsed()) {
          panel.expand()
          if (panel.getSize().inPixels < PLAN_MIN) panel.resize(PLAN_SIZE)
        }
        return
      }
      panel.collapse()
    },
    [isOpen, planRef]
  )

  function handleLayoutChanged(layout: SplitterLayout) {
    writeSplitterLayout(layout)
  }

  function openSettings() {
    void navigate('/agent/settings')
  }

  function handlePlanResize() {
    const panel = planRef.current
    if (!panel) return
    if (panel.isCollapsed() && isOpen) updateOpen(false)
  }

  return (
    <AgentRuntimeProvider>
      <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
        <div className={clsx(styles.chat)}>
          <AgentTitlebar className={styles.titlebar} />
          <div className={styles.body}>
            <ResizablePanelGroup
              id="agent-workbench"
              orientation="horizontal"
              className={styles.splitter}
              defaultLayout={defaultLayout}
              onLayoutChanged={handleLayoutChanged}>
              <ResizablePanel
                id={SESSION_ID}
                defaultSize={SESSION_SIZE}
                minSize={SESSION_MIN}
                maxSize={SESSION_MAX}
                collapsible
                collapsedSize={0}
                groupResizeBehavior="preserve-pixel-size">
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
                <main className={styles.thread}>
                  <Thread
                    components={{
                      Welcome: ThreadWelcome,
                      ComposerEnd: ComposerModelEnd
                    }}
                  />
                </main>
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel
                id={PLAN_ID}
                panelRef={planRef}
                defaultSize={PLAN_SIZE}
                minSize={PLAN_MIN}
                maxSize={PLAN_MAX}
                collapsible
                collapsedSize={0}
                groupResizeBehavior="preserve-pixel-size"
                onResize={handlePlanResize}>
                <AgentPlanPane
                  className={styles.planPane}
                  plan={plan}
                  onClose={function () {
                    updateOpen(false)
                  }}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      </AssistantLabelsProvider>
    </AgentRuntimeProvider>
  )
}

export default AgentChat
