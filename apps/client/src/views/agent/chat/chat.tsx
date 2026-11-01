/**
 * Agent 聊天子页：标题栏 + 三栏（工作区 | 主对话 | 右栏骨架）。
 *
 * 主对话走 assistant-ui `Thread`；右栏空/忙两种骨架（Qoder）；
 * Head 双侧 panel 图标控制开合并持久化。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { AssistantActionsProvider } from '@cogito/design/assistant/actions'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { Thread } from '@cogito/design/assistant/thread.aui'
import {
  Splitter,
  SplitterHandle,
  SplitterPane,
  useGroupRef,
  usePaneRef
} from '@cogito/design/components/splitter'
import { clsx } from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { attachPastedFiles } from '@/features/agent/attachment'
import { useActiveWorkspace } from '@/features/agent/workspace/active'

import { COMMAND } from '@/keyboard/definitions/ids'
import { useCommands } from '@/keyboard/react'
import { AgentAside } from '@/views/agent/chat/components/aside'
import { ComposerActions } from '@/views/agent/chat/components/composer-actions'
import { ComposerEnd } from '@/views/agent/chat/components/composer-end'
import { ComposerFooter } from '@/views/agent/chat/components/composer-footer'
import { ComposerTriggerList, useComposerTriggers } from '@/views/agent/chat/components/composer-triggers'
import { DelegateSurface } from '@/views/agent/chat/components/delegate-surface'
import { AgentHead } from '@/views/agent/chat/components/head'
import { AgentSidebar } from '@/views/agent/chat/components/sidebar'
import { useWindowMinimized } from '@/features/window/use-window-minimized'
import {
  findPreferredLayout,
  findSplitterLayout,
  findSplitterOpen,
  isSameSplitterLayout,
  LAYOUT_WIDTH_GUARD,
  MAIN_ID,
  mergePreferredLayout,
  PLAN_ID,
  PLAN_MAX,
  PLAN_MIN,
  PLAN_SIZE,
  resolveSplitterLayout,
  SESSION_ID,
  SESSION_MAX,
  SESSION_MIN,
  SESSION_SIZE,
  WORKBENCH_MIN,
  WORKBENCH_SIZE,
  writeSplitterLayout,
  writeSplitterOpen,
  type SplitterLayout,
  type SplitterOpen
} from '@/views/agent/chat/components/splitter-sizes'
import { AgentProcessFold, AgentProcessGroup } from '@/views/agent/chat/components/process-group'
import { GoalAutoAdvance } from '@/views/agent/chat/components/goal-auto-advance'
import { PlanScheduleCard } from '@/views/agent/chat/components/plan-schedule-card'
import { AgentToolCard } from '@/views/agent/chat/components/tool-card'
import { AgentToolGroup } from '@/views/agent/chat/components/tool-group'
import { ThreadWelcome } from '@/views/agent/chat/components/thread-welcome'
import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'
import { findAssistantActions } from '@/views/agent/chat/message-actions'
import { subscribeAsideReview } from '@/views/agent/chat/components/open-aside-review'
import { AgentRuntimeProvider } from '@/views/agent/chat/runtime'
import { AgentBrandBegin } from '@/views/agent/components/brand-begin'
import { TitlebarActions } from '@/views/agent/components/titlebar-actions'
import { useShellSurface } from '@/features/window-shell/slots'
import { syncCogitoGatewayCatalog } from '@/features/agent/acp/cogito-provider'
import {
  findActiveScenario,
  rememberActiveScenario,
  watchActiveScenario
} from '@/features/agent/model/active-scenario'
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { findLatestPlan } from '@/features/agent/plan'
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
        <AssistantActionsProvider actions={findAssistantActions()}>
          <AgentChatLayout />
        </AssistantActionsProvider>
      </AssistantLabelsProvider>
    </AgentRuntimeProvider>
  )
}

function AgentChatLayout() {
  const aui = useAui()
  const { rootPath } = useActiveWorkspace()
  const composerTriggers = useComposerTriggers()
  const navigate = useNavigate()
  const [layoutSeed] = useState(function () {
    const open = findSplitterOpen()
    const preferred = findPreferredLayout(findSplitterLayout())
    return {
      open,
      preferred,
      applied: resolveSplitterLayout(open, preferred)
    }
  })
  const [isSidebarOpen, updateSidebarOpen] = useState(layoutSeed.open.isSidebarOpen)
  const [isAsideOpen, updateAsideOpen] = useState(layoutSeed.open.isAsideOpen)
  const [isAsideMaximized, updateAsideMaximized] = useState(
    Boolean(layoutSeed.open.isAsideMaximized)
  )
  const [isSearchOpen, updateSearchOpen] = useState(false)
  const [scenario, updateScenario] = useState<ScenarioKey>(findActiveScenario)
  const [isShellNarrow, updateShellNarrow] = useState(false)
  /** 首屏对齐完成前关掉过渡 */
  const [isBootstrapping, updateBootstrapping] = useState(true)
  const isWindowMinimized = useWindowMinimized()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const groupRef = useGroupRef()
  const sidebarRef = usePaneRef()
  const mainRef = usePaneRef()
  const asideRef = usePaneRef()
  const openRef = useRef<SplitterOpen>({
    isSidebarOpen,
    isAsideOpen,
    isAsideMaximized
  })
  /** 拖拽记住的展开比例；折叠不改它 */
  const preferredLayoutRef = useRef<SplitterLayout>(layoutSeed.preferred)
  /** 当前应呈现的 applied 布局 = resolve(open, preferred) */
  const appliedLayoutRef = useRef<SplitterLayout>(layoutSeed.applied)
  const defaultLayout = layoutSeed.applied
  const isLayoutFrozenRef = useRef(true)
  const hasSeenHealthyWidthRef = useRef(false)
  const isBootstrappedRef = useRef(false)

  const showSidebar = isSidebarOpen && !isAsideMaximized
  const showAside = isAsideMaximized || isAsideOpen
  const isLayoutFrozen = isBootstrapping || isWindowMinimized || isShellNarrow

  /** 唯一写回 Splitter 的入口：永远是 applied，不是「偏好展开比例」 */
  const commitAppliedLayout = useCallback(
    function (open: SplitterOpen) {
      const applied = resolveSplitterLayout(open, preferredLayoutRef.current)
      appliedLayoutRef.current = applied
      try {
        // Splitter.setLayout 内部同值会短路
        groupRef.current?.setLayout(applied)
      } catch (error) {
        console.warn('[agent/chat] 写入分栏布局失败', error)
      }
      return applied
    },
    [groupRef]
  )

  /** 输入框粘贴：截图 → dataURL 附件，带路径的文件 → 工作区引用 */
  const handleComposerPaste = useCallback(
    async function (files: readonly File[]) {
      const result = await attachPastedFiles(aui, files, rootPath)
      if (result.failed.length > 0) {
        toast.warning(`无法直接引用：${result.failed.join('、')}，请用 + 从工作区选择`)
      }
    },
    [aui, rootPath]
  )

  useCommands([
    {
      id: COMMAND.AGENT_NEW_TASK,
      title: 'Agent：新建任务',
      keywords: 'new task thread',
      group: 'Agent',
      run() {
        aui.threads.switchToNewThread()
      }
    },
    {
      id: COMMAND.AGENT_FIND,
      title: 'Agent：搜索会话',
      keywords: 'find search threads',
      group: 'Agent',
      run() {
        updateSearchOpen(true)
      }
    },
    {
      id: COMMAND.AGENT_TOGGLE_SIDEBAR,
      title: '显示或隐藏会话列表',
      keywords: 'sidebar session list',
      group: 'Agent',
      run() {
        toggleSidebar()
      }
    },
    {
      id: COMMAND.AGENT_TOGGLE_ASIDE,
      title: '显示或隐藏工作区',
      keywords: 'aside files terminal browser',
      group: 'Agent',
      run() {
        toggleAside()
      }
    },
    {
      id: COMMAND.AGENT_MAXIMIZE_ASIDE,
      title: '专注工作区',
      keywords: 'focus maximize code browser terminal',
      group: 'Agent',
      run() {
        toggleAsideMaximize()
      }
    }
  ])

  useLayoutEffect(
    function () {
      openRef.current = { isSidebarOpen, isAsideOpen, isAsideMaximized }
    },
    [isSidebarOpen, isAsideOpen, isAsideMaximized]
  )

  useEffect(
    function () {
      isLayoutFrozenRef.current = isLayoutFrozen
    },
    [isLayoutFrozen]
  )

  /**
   * 客户区宽度：必须先见过一次健康宽度，才认假窄。
   * 否则首屏 flex 未撑开时的短暂窄宽会被当成最小化，触发回放/展开乱闪。
   */
  useEffect(
    function () {
      const node = bodyRef.current
      if (!node || typeof ResizeObserver === 'undefined') return

      function syncWidth() {
        const el = bodyRef.current
        if (!el) return
        const width = el.getBoundingClientRect().width
        if (width >= LAYOUT_WIDTH_GUARD) {
          hasSeenHealthyWidthRef.current = true
          updateShellNarrow(false)
          return
        }
        if (!hasSeenHealthyWidthRef.current) return
        if (width > 0) updateShellNarrow(true)
      }

      syncWidth()
      const observer = new ResizeObserver(syncWidth)
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    []
  )

  useEffect(function () {
    return watchActiveScenario(updateScenario)
  }, [])

  function onScenarioChange(next: ScenarioKey) {
    rememberActiveScenario(next)
    updateScenario(next)
  }

  function persistOpen(next: {
    isSidebarOpen: boolean
    isAsideOpen: boolean
    isAsideMaximized: boolean
  }) {
    writeSplitterOpen(next)
  }

  const openAside = useCallback(function () {
    updateAsideOpen(true)
    persistOpen({
      isSidebarOpen: openRef.current.isSidebarOpen,
      isAsideOpen: true,
      isAsideMaximized: openRef.current.isAsideMaximized ?? false
    })
  }, [])

  const plan = usePlanAutoOpen(isAsideOpen, openAside)

  useEffect(
    function () {
      return subscribeAsideReview(function () {
        openAside()
      })
    },
    [openAside]
  )

  useEffect(function () {
    void useAgentStore.getState().toReadWorkspaces()
    void useAgentStore.getState().toReadWorkspaceFolders()
    void useAgentStore.getState().toReadSessions()
    void useProviderStore
      .getState()
      .toReadProviders()
      .then(function () {
        return syncCogitoGatewayCatalog()
      })
      .catch(function (error) {
        console.warn('[agent/chat] 同步组织模型失败:', error)
      })
  }, [])

  /** 首屏：把 applied 钉进 Splitter 后松 freeze（defaultLayout 已是 applied） */
  useLayoutEffect(
    function () {
      if (isBootstrappedRef.current) return
      if (!groupRef.current) return
      isBootstrappedRef.current = true
      commitAppliedLayout(openRef.current)
      updateBootstrapping(false)
    },
    [groupRef, commitAppliedLayout]
  )

  /**
   * 开合变化 → 只 commit applied。
   * 不再 collapse()/expand() 二次对齐：那会在「快照仍是展开比例」时先画开再收起。
   */
  useLayoutEffect(
    function () {
      if (!isBootstrappedRef.current) return
      if (isLayoutFrozen) return
      commitAppliedLayout({
        isSidebarOpen,
        isAsideOpen,
        isAsideMaximized
      })
    },
    [
      isSidebarOpen,
      isAsideOpen,
      isAsideMaximized,
      isLayoutFrozen,
      groupRef,
      commitAppliedLayout
    ]
  )

  /**
   * 假窄进入/离开：回放 applied（已含开合）。
   * 与「开合变化」effect 合并职责上不重复写分支；此处专盯窗口几何变化。
   */
  useLayoutEffect(
    function () {
      if (!isBootstrappedRef.current) return
      commitAppliedLayout(openRef.current)
    },
    [isWindowMinimized, isShellNarrow, groupRef, commitAppliedLayout]
  )

  function handleLayoutChanged(
    layout: SplitterLayout,
    meta?: { isUserInteraction?: boolean }
  ) {
    // 假窄 / 首屏冻结：钉回 applied，绝不写入偏好
    if (isLayoutFrozenRef.current) {
      if (!isSameSplitterLayout(layout, appliedLayoutRef.current)) {
        queueMicrotask(function () {
          if (!isLayoutFrozenRef.current) return
          commitAppliedLayout(openRef.current)
        })
      }
      return
    }

    // 只在用户拖拽时更新偏好并持久化；折叠不落盘 0
    if (!meta?.isUserInteraction) return
    const preferred = mergePreferredLayout(
      preferredLayoutRef.current,
      layout,
      openRef.current
    )
    preferredLayoutRef.current = preferred
    appliedLayoutRef.current = resolveSplitterLayout(openRef.current, preferred)
    writeSplitterLayout(preferred)
  }

  /** 把手折叠钮 → 与标题栏/快捷键同一套开合状态（layout 由上面的 open effect 提交） */
  function handleCollapse(collapsedById: Record<string, boolean>) {
    if (isLayoutFrozenRef.current) return
    if (openRef.current.isAsideMaximized) return

    const nextSidebar = !(collapsedById[SESSION_ID] ?? false)
    const nextAside = !(collapsedById[PLAN_ID] ?? false)
    if (
      nextSidebar === openRef.current.isSidebarOpen &&
      nextAside === openRef.current.isAsideOpen
    ) {
      return
    }
    updateSidebarOpen(nextSidebar)
    updateAsideOpen(nextAside)
    persistOpen({
      isSidebarOpen: nextSidebar,
      isAsideOpen: nextAside,
      isAsideMaximized: false
    })
  }

  /** 左侧栏开合只走按钮 / 快捷键；折叠后禁用拖拽把手，避免拖开。 */
  function toggleSidebar() {
    if (openRef.current.isAsideMaximized) return
    const next = !openRef.current.isSidebarOpen
    updateSidebarOpen(next)
    persistOpen({
      isSidebarOpen: next,
      isAsideOpen: openRef.current.isAsideOpen,
      isAsideMaximized: false
    })
  }

  function toggleAside() {
    if (openRef.current.isAsideMaximized) {
      // 专注态再关工作区：一并退出专注并恢复中栏
      updateAsideMaximized(false)
      updateAsideOpen(false)
      persistOpen({
        isSidebarOpen: openRef.current.isSidebarOpen,
        isAsideOpen: false,
        isAsideMaximized: false
      })
      return
    }
    const next = !openRef.current.isAsideOpen
    updateAsideOpen(next)
    persistOpen({
      isSidebarOpen: openRef.current.isSidebarOpen,
      isAsideOpen: next,
      isAsideMaximized: false
    })
  }

  function toggleAsideMaximize() {
    if (openRef.current.isAsideMaximized) {
      updateAsideMaximized(false)
      updateAsideOpen(true)
      persistOpen({
        isSidebarOpen: openRef.current.isSidebarOpen,
        isAsideOpen: true,
        isAsideMaximized: false
      })
      return
    }
    updateAsideMaximized(true)
    updateAsideOpen(true)
    updateSidebarOpen(false)
    persistOpen({
      isSidebarOpen: false,
      isAsideOpen: true,
      isAsideMaximized: true
    })
  }

  function openSettings(section?: string) {
    void navigate(section ? `/agent/settings?section=${section}` : '/agent/settings')
  }

  useShellSurface({
    begin: <AgentBrandBegin />,
    final: (
      <TitlebarActions
        layout={{
          isSidebarOpen: showSidebar,
          isAsideOpen: showAside,
          isAsideMaximized: isAsideMaximized
        }}
        extra={<DelegateSurface />}
      />
    ),
    scrollable: false
  })

  return (
    <div className={clsx(styles.surface)}>
      <div ref={bodyRef} className={styles.body}>
        <Splitter
          id="agent-workbench"
          groupRef={groupRef}
          orientation="horizontal"
          className={styles.splitter}
          defaultLayout={defaultLayout}
          disabled={isLayoutFrozen}
          freezeTransition={isLayoutFrozen}
          onLayoutChanged={handleLayoutChanged}
          onCollapse={handleCollapse}>
          <SplitterPane
            id={SESSION_ID}
            paneRef={sidebarRef}
            defaultSize={SESSION_SIZE}
            min={SESSION_MIN}
            max={SESSION_MAX}
            collapsible={{ end: true }}
            collapsedSize={0}>
            <AgentSidebar
              className={styles.sidebar}
              scenario={scenario}
              isSearchOpen={isSearchOpen}
              onScenarioChange={onScenarioChange}
              onSearchOpenChange={updateSearchOpen}
              onOpenSettings={openSettings}
            />
          </SplitterPane>

          <SplitterHandle withHandle disableDoubleClick disabled={isLayoutFrozen} />

          <SplitterPane
            id={MAIN_ID}
            paneRef={mainRef}
            defaultSize={WORKBENCH_SIZE}
            min={WORKBENCH_MIN}
            collapsedSize={0}>
            <div className={clsx(styles.workbench, styles.thread)}>
              <AgentHead />
              <main className={styles.threadMain}>
                <Thread
                  components={{
                    Welcome: ThreadWelcome,
                    ToolFallback: AgentToolCard,
                    ToolGroup: AgentToolGroup,
                    ReasoningGroup: AgentProcessGroup,
                    ProcessGroup: AgentProcessFold,
                    ComposerStart: ComposerActions,
                    ComposerAttach: null,
                    ComposerEnd: ComposerEnd,
                    ComposerFooter: ComposerFooter,
                    ComposerTriggers: composerTriggers,
                    ComposerTriggerList: ComposerTriggerList,
                    ComposerPaste: handleComposerPaste
                  }}
                />
                <GoalAutoAdvance />
                <PlanScheduleCard />
              </main>
            </div>
          </SplitterPane>

          <SplitterHandle
            withHandle
            disableDoubleClick
            disabled={isAsideMaximized || isLayoutFrozen}
          />

          <SplitterPane
            id={PLAN_ID}
            paneRef={asideRef}
            defaultSize={PLAN_SIZE}
            min={PLAN_MIN}
            max={PLAN_MAX}
            collapsible={{ start: true }}
            collapsedSize={0}>
            <AgentAside
              className={styles.planPane}
              plan={plan}
            />
          </SplitterPane>
        </Splitter>
      </div>
    </div>
  )
}

export default AgentChat
