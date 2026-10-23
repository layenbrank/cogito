import { useAui, useAuiState } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { Thread } from '@cogito/design/assistant/thread.aui'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
} from '@cogito/design/components/resizable'
import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { findLatestPlan } from '@/features/agent/plan.ts'
import { ASSISTANT_LABELS_ZH } from '@/features/chat/labels.ts'
import { ChatRuntimeProvider } from '@/features/chat/runtime.tsx'
import { cycleModel } from '@/features/chat/model-cycle.ts'
import { useThreadKey } from '@/features/chat/session.ts'
import { RuntimeNotice } from '@/features/tool/notice.tsx'
import { useWindowShortcuts } from '@/features/window/shortcuts.ts'

import { useAgentStore } from '@/stores/agent.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'
import { AsidePanelProvider } from '@/views/agent/chat/components/aside-panel.tsx'
import AgentAside from '@/views/agent/chat/components/aside.tsx'
import { ComposerActions } from '@/views/agent/chat/components/composer-actions.tsx'
import { ComposerEnd } from '@/views/agent/chat/components/composer-end.tsx'
import { ComposerFooter } from '@/views/agent/chat/components/composer-footer.tsx'
import { ComposerTriggers } from '@/views/agent/chat/components/composer-triggers.tsx'
import AgentHead from '@/views/agent/chat/components/head.tsx'
import {
  AgentProcessFold,
  AgentProcessGroup
} from '@/views/agent/chat/components/process-group.tsx'
import AgentSidebar from '@/views/agent/chat/components/sidebar.tsx'
import {
  MAIN_ID,
  MAIN_MIN,
  PANEL_ID,
  PANEL_MAX,
  PANEL_MIN,
  PANEL_SIZE,
  SIDEBAR_ID,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_SIZE,
  findSplitterState,
  writeSplitterState,
  type SplitterLayout
} from '@/views/agent/chat/components/splitter-sizes.ts'
import { AgentToolCard } from '@/views/agent/chat/components/tool-card.tsx'
import { AgentToolGroup } from '@/views/agent/chat/components/tool-group.tsx'
import AgentUtility from '@/views/agent/components/utility.tsx'
import { ThreadWelcome } from '@/views/agent/chat/components/welcome.tsx'
import { useAsidePanel } from '@/views/agent/chat/components/use-aside-panel.ts'

import styles from './chat.module.scss'

/**
 * 有计划时自动展开右栏（对齐 Qoder plan 场景）。
 *
 * 按「计划总量」记一次已开，计划条目更新（总量变化）才再开一次 ——
 * 用户手动收起后不会被同一次计划反复顶开。记账要带上线程键：这个组件跨会话存活，
 * 只记一个数字的话，上一个会话的计划会顶掉这一个会话的第一次展开。
 */
function PlanAsideOpener() {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const threadKey = useThreadKey()
  const plan = useMemo(
    function () {
      return findLatestPlan(messages)
    },
    [messages]
  )
  const { isOpen, open } = useAsidePanel()
  const openedFor = useRef<{ threadKey: string | null; total: number } | null>(null)
  const openRef = useRef(open)

  useEffect(
    function () {
      openRef.current = open
    },
    [open]
  )

  useEffect(
    function () {
      if (!plan || plan.total === 0) return
      const opened = openedFor.current

      if (isOpen) {
        openedFor.current = { threadKey, total: plan.total }
        return
      }
      if (opened?.threadKey === threadKey && opened.total === plan.total) return

      openedFor.current = { threadKey, total: plan.total }
      openRef.current('plan')
    },
    [plan, isOpen, threadKey]
  )

  return null
}

/**
 * Agent 工作台（Qoder 式三栏）：左侧任务栏 | 中栏对话 | 右侧任务详情。
 * 顶部是窗口标题栏（拖拽区）由 `components/utility` 提供。
 *
 * 三栏始终挂载；开合走 `collapse` / `expand`（带动效），不再条件卸载。
 * 栏宽与开合状态一并写入 localStorage。
 *
 * 入口唯一性：设置**只由左栏底部**进入。
 * 各栏职责：换工作区在左栏，换模型 / 访问权限在输入区右下角，右栏只读当前任务快照。
 */
export default function Agent() {
  const navigate = useNavigate()
  const aui = useAui()
  const sidebarRef = usePanelRef()
  const asideRef = usePanelRef()
  const [initial] = useState(findSplitterState)
  const [isSidebarOpen, updateSidebarOpen] = useState(initial.isSidebarOpen)
  const [isAsideOpen, updateAsideOpen] = useState(initial.isAsideOpen)
  const [searchFocusToken, updateSearchFocusToken] = useState(0)
  const [defaultLayout] = useState(initial.layout)
  const openRef = useRef({ isSidebarOpen: initial.isSidebarOpen, isAsideOpen: initial.isAsideOpen })

  useEffect(
    function () {
      openRef.current = { isSidebarOpen, isAsideOpen }
    },
    [isSidebarOpen, isAsideOpen]
  )

  const loaded = useAgentStore(function (state) {
    return state.loaded
  })
  const initialize = useAgentStore(function (state) {
    return state.initialize
  })

  useEffect(
    function () {
      void initialize().catch(function (error) {
        toast.error(toIpcMessage(error, '本地状态读取失败'))
      })
    },
    [initialize]
  )

  // 挂载后按存档开合一次（右栏默认收起）
  useEffect(
    function () {
      const sidebar = sidebarRef.current
      const aside = asideRef.current
      if (!sidebar || !aside) return

      if (openRef.current.isSidebarOpen) sidebar.expand()
      else sidebar.collapse()

      if (openRef.current.isAsideOpen) aside.expand()
      else aside.collapse()
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
          // 从未展开过时 expand 可能停在 0，强制拉到默认宽
          if (panel.getSize().inPixels < PANEL_MIN) panel.resize(PANEL_SIZE)
        }
      } else {
        panel.collapse()
      }
    },
    [isAsideOpen, asideRef]
  )

  useWindowShortcuts({
    'toggle-sidebar': function () {
      updateSidebarOpen(function (open) {
        return !open
      })
    },
    'toggle-aside': function () {
      updateAsideOpen(function (open) {
        return !open
      })
    },
    'new-task': function () {
      void aui.threads.switchToNewThread()
    },
    'search-threads': function () {
      updateSidebarOpen(true)
      updateSearchFocusToken(function (token) {
        return token + 1
      })
    },
    'cycle-model': function () {
      void cycleModel(1).catch(function (error) {
        toast.error(toIpcMessage(error, '切换模型失败'))
      })
    },
    'open-settings': function () {
      void navigate('/agent/settings')
    }
  })

  if (!loaded) return null

  function persistOpen(next: { isSidebarOpen: boolean; isAsideOpen: boolean }) {
    writeSplitterState({
      layout: findSplitterState().layout,
      isSidebarOpen: next.isSidebarOpen,
      isAsideOpen: next.isAsideOpen
    })
  }

  function handleLayoutChanged(layout: SplitterLayout) {
    writeSplitterState({
      layout,
      isSidebarOpen: openRef.current.isSidebarOpen,
      isAsideOpen: openRef.current.isAsideOpen
    })
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

  return (
    <ChatRuntimeProvider>
      <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
        <AsidePanelProvider
          isOpen={isAsideOpen}
          onOpenChange={updateAsideOpen}>
          <PlanAsideOpener />
          <div className={clsx(styles.agent)}>
            <AgentUtility />
            <ResizablePanelGroup
              id="agent-workbench"
              orientation="horizontal"
              className={clsx(styles.body)}
              defaultLayout={defaultLayout}
              onLayoutChanged={handleLayoutChanged}>
              <ResizablePanel
                id={SIDEBAR_ID}
                panelRef={sidebarRef}
                defaultSize={SIDEBAR_SIZE}
                minSize={SIDEBAR_MIN}
                maxSize={SIDEBAR_MAX}
                collapsible
                collapsedSize={0}
                groupResizeBehavior="preserve-pixel-size"
                onResize={handleSidebarResize}
                className={styles.sidePanel}>
                <AgentSidebar
                  searchFocusToken={searchFocusToken}
                  onOpenSettings={function () {
                    void navigate('/agent/settings')
                  }}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                id={MAIN_ID}
                minSize={MAIN_MIN}>
                <main className={clsx(styles.main)}>
                  <AgentHead
                    isSidebarOpen={isSidebarOpen}
                    isAsideOpen={isAsideOpen}
                    onToggleSidebar={function () {
                      updateSidebarOpen(!isSidebarOpen)
                    }}
                    onToggleAside={function () {
                      updateAsideOpen(!isAsideOpen)
                    }}
                  />
                  <RuntimeNotice />
                  <div className={clsx(styles.thread)}>
                    <Thread
                      components={{
                        ToolFallback: AgentToolCard,
                        ToolGroup: AgentToolGroup,
                        ReasoningGroup: AgentProcessGroup,
                        ProcessGroup: AgentProcessFold,
                        ComposerStart: ComposerActions,
                        ComposerAttach: null,
                        ComposerEnd: ComposerEnd,
                        ComposerFooter: ComposerFooter,
                        ComposerTriggers: ComposerTriggers,
                        Welcome: ThreadWelcome
                      }}
                    />
                  </div>
                </main>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                id={PANEL_ID}
                panelRef={asideRef}
                defaultSize={PANEL_SIZE}
                minSize={PANEL_MIN}
                maxSize={PANEL_MAX}
                collapsible
                collapsedSize={0}
                groupResizeBehavior="preserve-pixel-size"
                onResize={handleAsideResize}
                className={styles.sidePanel}>
                <AgentAside
                  onClose={function () {
                    updateAsideOpen(false)
                  }}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </AsidePanelProvider>
      </AssistantLabelsProvider>
    </ChatRuntimeProvider>
  )
}
