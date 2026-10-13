/**
 * Agent 聊天子页：标题栏 + 三栏（工作区 | 主对话 | Plan）。
 *
 * 是 `/agent` 的默认子页（`/agent` 会重定向过来）；模型接入不在这里弹窗，走
 * `/agent/settings`（见 `views/agent/settings/`）。
 *
 * 主对话栏已经换成 assistant-ui 的 `Thread`（一条通路：会话列表 / 生成 / 历史全套走
 * `features/agent/port/*`）。左栏（工作区 / 场景导航）与右栏（计划）沿用旧组件，
 * 尚未随这次接线一起换成运行时状态 —— 见计划文档「PR4③b 剩余」。
 */
import { AssistantLabelsProvider } from '@i-thinking/design/assistant/labels'
import { Thread } from '@i-thinking/design/assistant/thread.aui'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
} from '@i-thinking/design/components/resizable'
import { clsx } from 'clsx'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ComposerModelEnd } from '@/views/agent/chat/components/composer-model-end'
import { AgentPlanPane, type PlanPaneSource } from '@/views/agent/chat/components/plan-pane'
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
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { parseParts, stringifyParts } from '@/features/agent/model/tools'
import { useCalendarStore } from '@/stores/calendar'
import { useAgentStore } from '@/stores/agent.ts'
import { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/chat/chat.module.scss'

interface PlanSelection {
  messageID: string
  partIndex: number
}

function findPlanSource(
  selection: PlanSelection | null,
  messages: { id: string; parts: string | null }[]
): PlanPaneSource | null {
  if (!selection) return null
  const target = messages.find(function (item) {
    return item.id === selection.messageID
  })
  if (!target) return null
  const parts = parseParts(target.parts)
  const part = parts[selection.partIndex]
  if (!part || part.type !== 'plan') return null
  return {
    messageID: selection.messageID,
    partIndex: selection.partIndex,
    data: part.data
  }
}

function AgentChat() {
  const navigate = useNavigate()
  const [defaultLayout] = useState(findSplitterLayout)
  const [isSearchOpen, updateSearchOpen] = useState(false)
  const [scenario, updateScenario] = useState<ScenarioKey>('general')
  const [planSelection, updatePlanSelection] = useState<PlanSelection | null>(null)
  const planRef = usePanelRef()
  const messages = useAgentStore(function (state) {
    return state.messages
  })
  const planSource = findPlanSource(planSelection, messages)

  useEffect(function () {
    void useAgentStore.getState().toReadWorkspaces()
    void useAgentStore.getState().toReadWorkspaceFolders()
    void useAgentStore.getState().toReadSessions()
    void useProviderStore.getState().toReadProviders()
  }, [])

  // Plan 栏开合跟着选中状态走：收起即清空选中，避免留下看不见的旧计划
  useEffect(
    function () {
      const panel = planRef.current
      if (!panel) return
      if (planSelection) {
        if (panel.isCollapsed()) {
          panel.expand()
          if (panel.getSize().inPixels < PLAN_MIN) panel.resize(PLAN_SIZE)
        }
        return
      }
      panel.collapse()
    },
    [planSelection, planRef]
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
    if (panel.isCollapsed() && planSelection) updatePlanSelection(null)
  }

  function openPlanPane(source: PlanPaneSource) {
    updatePlanSelection({
      messageID: source.messageID,
      partIndex: source.partIndex
    })
  }

  function closePlanPane() {
    updatePlanSelection(null)
  }

  async function handleTogglePlanItem(itemIndex: number) {
    if (!planSource) return
    const target = useAgentStore.getState().messages.find(function (item) {
      return item.id === planSource.messageID
    })
    if (!target) return
    const parts = parseParts(target.parts)
    const part = parts[planSource.partIndex]
    if (!part || part.type !== 'plan') return
    const items = part.data.items.map(function (item, index) {
      return index === itemIndex ? { ...item, done: !item.done } : item
    })
    const data = { ...part.data, items }
    parts[planSource.partIndex] = { type: 'plan', data }
    await useAgentStore
      .getState()
      .toUpdateMessage([{ id: planSource.messageID, parts: stringifyParts(parts) }])
  }

  async function handleWritePlanCalendar() {
    if (!planSource) return
    const target = useAgentStore.getState().messages.find(function (item) {
      return item.id === planSource.messageID
    })
    if (!target) return
    const parts = parseParts(target.parts)
    const part = parts[planSource.partIndex]
    if (!part || part.type !== 'plan') return

    const base = dayjs(part.data.date || undefined).startOf('day')
    for (const item of part.data.items) {
      let start = base
      if (item.time) {
        const [hour, minute] = item.time.split(':').map(Number)
        start = base.hour(hour || 0).minute(minute || 0)
      }
      const end = item.time ? start.add(30, 'minute') : base.endOf('day')
      await useCalendarStore.getState().toWriteEvent({
        title: item.title,
        notes: '由 Agent 计划生成',
        startAt: start.valueOf(),
        endAt: end.valueOf(),
        entireDay: !item.time
      })
    }
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
                  source={planSource}
                  onClose={closePlanPane}
                  onToggleItem={function (itemIndex) {
                    void handleTogglePlanItem(itemIndex)
                  }}
                  onWriteCalendar={handleWritePlanCalendar}
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
