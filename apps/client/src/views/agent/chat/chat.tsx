/**
 * Agent 聊天子页：标题栏 + 三栏（工作区 | 主对话 | 右栏骨架）。
 *
 * 主对话走 assistant-ui `Thread`；右栏空/忙两种骨架（Qoder）。
 *
 * 分隔条是**可见的**（细线 + 中间抓手，悬停 / 拖拽变亮），但**不带折叠钮**：开合与专注
 * 只由标题栏 `TitlebarActions` 的按钮（及其快捷键）改 open 状态，布局统一在 open effect 里
 * 提交；拖拽只调宽，松手后把比例写回偏好并落盘。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { AssistantActionsProvider } from '@cogito/design/assistant/actions'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { Thread } from '@cogito/design/assistant/thread.aui'
import {
  Splitter,
  SplitterHandle,
  SplitterPane,
  useGroupRef
} from '@cogito/design/components/splitter'
import { clsx } from 'clsx'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
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
import { ComposerQueue } from '@/views/agent/chat/components/composer-queue'
import {
  ComposerTriggerList,
  useComposerTriggers
} from '@/views/agent/chat/components/composer-triggers'
import { DelegateSurface } from '@/views/agent/chat/components/delegate-surface'
import { AgentHead } from '@/views/agent/chat/components/head'
import { AgentSidebar } from '@/views/agent/chat/components/sidebar'
import { AutomationSessionPicker } from '@/views/agent/chat/components/automation-session-picker'
import { useWindowMinimized } from '@/features/window/use-window-minimized'
import {
  findDefaultLayout,
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
import { AgentProcessGroup } from '@/views/agent/chat/components/process-group'
import { GoalAutoAdvance } from '@/views/agent/chat/components/goal-auto-advance'
import { PlanRunFinish } from '@/views/agent/chat/components/plan-run-finish'
import { PlanRecorder } from '@/views/agent/chat/components/plan-recorder'
import { PlanFileSync } from '@/views/agent/chat/components/plan-file-sync'
import { PlanScheduleCard } from '@/views/agent/chat/components/plan-schedule-card'
import { PromptLibraryManager } from '@/views/agent/chat/components/prompt-library-manager'
import { AgentToolCard } from '@/views/agent/chat/components/tool-card'
import { AgentFileChangeTree } from '@/views/agent/chat/components/file-change-tree'
import { MessageTimingStats } from '@/views/agent/chat/components/message-timing'
import { ThreadWelcome } from '@/views/agent/chat/components/thread-welcome'
import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'
import { findAssistantActions } from '@/views/agent/chat/message-actions'
import { subscribeAsideBrowser } from '@/views/agent/chat/components/open-aside-browser'
import { subscribeAsideTerminal } from '@/views/agent/chat/components/open-aside-terminal'
import { openAsideTasks, subscribeAsideTasks } from '@/views/agent/chat/components/open-aside-tasks'
import { subscribeAsideReview } from '@/views/agent/chat/components/open-aside-review'
import { subscribeAsideContext } from '@/views/agent/chat/components/open-aside-context'
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
import { readPlan, subscribePlanStore } from '@/features/agent/plan-store'
import { useAgentStore } from '@/stores/agent.ts'
import { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/chat/chat.module.scss'

/**
 * plan 到达时自动展开右栏（不覆盖用户手动收起：同线程同总量只顶一次）。
 *
 * 独立子树订阅：只暴露 `total` 标量，避免整份 `messages` 抬升 `AgentChatLayout`
 * 在每个 token 上重渲染分栏外壳。
 */
function PlanAutoOpen(props: { isAsideOpen: boolean; openAside: () => void }) {
  const { isAsideOpen, openAside } = props
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  /** 计划模式的 Markdown 计划不产生 goose 的 `plan` part：档案里的步数也要算 */
  const storedTotal = useSyncExternalStore(
    subscribePlanStore,
    function () {
      return readPlan(threadID)?.steps.length ?? 0
    },
    function () {
      return 0
    }
  )
  const planTotal = useAuiState(function (state) {
    const plan = findLatestPlan(state.thread.messages)
    return Math.max(plan?.total ?? 0, storedTotal)
  })
  const openedFor = useRef<{ threadID: string; total: number } | null>(null)

  useEffect(
    function () {
      if (planTotal === 0) return
      const opened = openedFor.current
      if (opened?.threadID === threadID && opened.total === planTotal) return
      openedFor.current = { threadID, total: planTotal }
      if (!isAsideOpen) openAside()
    },
    [planTotal, threadID, isAsideOpen, openAside]
  )

  return null
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
  const { primaryRootPath, folderPaths } = useActiveWorkspace()
  const composerTriggers = useComposerTriggers()
  const navigate = useNavigate()
  const [layoutSeed] = useState(function () {
    const open = findSplitterOpen()
    const stored = findSplitterLayout()
    const preferred = findPreferredLayout(stored)
    return {
      open,
      stored,
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
  const openRef = useRef<SplitterOpen>({
    isSidebarOpen,
    isAsideOpen,
    isAsideMaximized
  })
  /** 「展开比例」：开合时用来还原宽度；折叠不改它（0 不落盘） */
  const preferredLayoutRef = useRef<SplitterLayout>(layoutSeed.preferred)
  /** 当前应呈现的 applied 布局 = resolve(open, preferred) */
  const appliedLayoutRef = useRef<SplitterLayout>(layoutSeed.applied)
  const defaultLayout = layoutSeed.applied
  /** 无存档时按容器实际宽度给首屏比例：两侧栏保像素宽，多出来的宽度交给中栏 */
  const defaultLayoutByWidth = useCallback(
    function (containerPx: number) {
      if (layoutSeed.open.isAsideMaximized) {
        return { [SESSION_ID]: 0, [MAIN_ID]: 0, [PLAN_ID]: 100 }
      }
      const layout = findDefaultLayout(containerPx)
      if (!layoutSeed.open.isSidebarOpen) layout[SESSION_ID] = 0
      if (!layoutSeed.open.isAsideOpen) layout[PLAN_ID] = 0
      return layout
    },
    [layoutSeed]
  )
  const isLayoutFrozenRef = useRef(true)
  const hasSeenHealthyWidthRef = useRef(false)
  const isBootstrappedRef = useRef(false)
  /** 容器尺寸变化后延到下一帧再读实际比例（此时库已重算完 ptg） */
  const resizeSyncFrameRef = useRef(0)

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

  /** 输入框粘贴 / 拖拽：截图 → dataURL 附件，带路径的文件 → 工作区引用（两条入口共用一套语义） */
  const handleComposerFiles = useCallback(
    async function (files: readonly File[]) {
      const result = await attachPastedFiles(aui, files, folderPaths, primaryRootPath)
      if (result.failed.length > 0) {
        toast.warning(`无法直接引用：${result.failed.join('、')}，请用 + 从工作区选择`)
      }
    },
    [aui, folderPaths, primaryRootPath]
  )

  /**
   * `<Thread>` 元素本身 memo 住。
   * 依赖只放真正会变的两项：触发器快照与粘贴回调。
   */
  const threadElement = useMemo(
    function () {
      return (
        <Thread
          components={{
            Welcome: ThreadWelcome,
            ToolFallback: AgentToolCard,
            ReasoningGroup: AgentProcessGroup,
            ProcessFooter: MessageTimingStats,
            RunSummary: AgentFileChangeTree,
            ComposerStart: ComposerActions,
            ComposerAttach: null,
            ComposerEnd: ComposerEnd,
            ComposerFooter: ComposerFooter,
            ComposerQueue: ComposerQueue,
            ComposerTriggers: composerTriggers,
            ComposerTriggerList: ComposerTriggerList,
            ComposerPaste: handleComposerFiles,
            ComposerDrop: handleComposerFiles
          }}
        />
      )
    },
    [composerTriggers, handleComposerFiles]
  )

  useCommands([
    {
      id: COMMAND.AGENT_NEW_TASK,
      title: 'Agent：新建会话',
      keywords: 'new task thread',
      group: 'Agent',
      run() {
        aui.threads.switchToNewThread()
      }
    },
    {
      id: COMMAND.AGENT_OPEN_TASKS,
      title: 'Agent：打开任务',
      keywords: 'tasks schedule cron 任务 定时 排期',
      group: 'Agent',
      run() {
        openAsideTasks()
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
        // 窗口变宽/变窄：库按 preservePixel 保住两侧栏像素宽、中栏吃掉差额，
        // 这里把「实际比例」回写到偏好，免得下次开合又按旧比例跳一下。
        if (resizeSyncFrameRef.current !== 0)
          window.cancelAnimationFrame(resizeSyncFrameRef.current)
        resizeSyncFrameRef.current = window.requestAnimationFrame(function () {
          resizeSyncFrameRef.current = 0
          if (!isBootstrappedRef.current || isLayoutFrozenRef.current) return
          const live = groupRef.current?.findLayout()
          if (!live) return
          preferredLayoutRef.current = mergePreferredLayout(
            preferredLayoutRef.current,
            live,
            openRef.current
          )
        })
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
        if (resizeSyncFrameRef.current !== 0)
          window.cancelAnimationFrame(resizeSyncFrameRef.current)
        observer.disconnect()
      }
    },
    [groupRef]
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

  useEffect(
    function () {
      return subscribeAsideReview(function () {
        openAside()
      })
    },
    [openAside]
  )

  useEffect(
    function () {
      return subscribeAsideBrowser(function () {
        openAside()
      })
    },
    [openAside]
  )

  useEffect(
    function () {
      return subscribeAsideTerminal(function () {
        openAside()
      })
    },
    [openAside]
  )

  useEffect(
    function () {
      return subscribeAsideTasks(function () {
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

  useEffect(
    function () {
      return subscribeAsideContext(function () {
        openAside()
      })
    },
    [openAside]
  )

  /** 首屏：把 applied 钉进 Splitter 后松 freeze（defaultLayout 已是 applied） */
  useLayoutEffect(
    function () {
      if (isBootstrappedRef.current) return
      if (!groupRef.current) return
      isBootstrappedRef.current = true
      // 无存档时首屏比例已由 `defaultLayoutByWidth` 按容器宽算好；这里再对齐偏好/应用两份 ref。
      // 折叠栏的「偏好宽度」也用当前宽度下的像素默认换算，重开时不会跳回写死的 23% / 30%。
      const width = bodyRef.current?.getBoundingClientRect().width ?? 0
      if (width > 0) {
        const preferred = findPreferredLayout(layoutSeed.stored, findDefaultLayout(width))
        preferredLayoutRef.current = preferred
        appliedLayoutRef.current = resolveSplitterLayout(openRef.current, preferred)
      }
      commitAppliedLayout(openRef.current)
      updateBootstrapping(false)
    },
    [groupRef, commitAppliedLayout, layoutSeed.stored]
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
    [isSidebarOpen, isAsideOpen, isAsideMaximized, isLayoutFrozen, groupRef, commitAppliedLayout]
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

  /**
   * 布局变化有两个来源，处理方式不同：
   *
   * - **冻结期**（首屏 / 最小化 / 假窄）库自己重算的比例不算数，钉回 applied；
   * - **用户拖拽**：只有松手那一帧带 `isUserInteraction`（跟手帧不落盘），
   *   这时把实际比例并入偏好并写回存档，下次开合还按这个宽度还原。
   *
   * 分隔条只负责拖拽调宽；折叠 / 展开只认标题栏按钮。
   */
  function handleLayoutChanged(layout: SplitterLayout, meta?: { isUserInteraction?: boolean }) {
    if (isLayoutFrozenRef.current) {
      if (!isSameSplitterLayout(layout, appliedLayoutRef.current)) {
        queueMicrotask(function () {
          if (!isLayoutFrozenRef.current) return
          commitAppliedLayout(openRef.current)
        })
      }
      return
    }

    if (!meta?.isUserInteraction) return
    const preferred = mergePreferredLayout(preferredLayoutRef.current, layout, openRef.current)
    preferredLayoutRef.current = preferred
    appliedLayoutRef.current = resolveSplitterLayout(openRef.current, preferred)
    writeSplitterLayout(preferred)
  }

  /** 左侧栏开合只走标题栏按钮 / 快捷键；拖拽只调宽，不改开合。 */
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
      <div
        ref={bodyRef}
        className={styles.body}>
        <Splitter
          id="agent-workbench"
          groupRef={groupRef}
          orientation="horizontal"
          className={styles.splitter}
          defaultLayout={layoutSeed.stored ? defaultLayout : undefined}
          defaultLayoutByWidth={defaultLayoutByWidth}
          freezeTransition={isLayoutFrozen}
          disabled={isLayoutFrozen}
          onLayoutChanged={handleLayoutChanged}>
          <SplitterPane
            id={SESSION_ID}
            defaultSize={SESSION_SIZE}
            min={SESSION_MIN}
            max={SESSION_MAX}
            preservePixel
            // 收起的栏不给拖：0 宽的分隔条被拖开只会露出一条缝，开合归标题栏管
            resizable={showSidebar}
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

          {/* 可见分隔条 + 抓手；折叠 / 展开只走标题栏按钮 */}
          <SplitterHandle
            withHandle
            disableDoubleClick
          />

          <SplitterPane
            id={MAIN_ID}
            defaultSize={WORKBENCH_SIZE}
            min={WORKBENCH_MIN}
            // 专注态（右栏独占）时中栏是 0 宽，同样不参与拖拽
            resizable={!isAsideMaximized}
            collapsedSize={0}>
            <div className={clsx(styles.workbench, styles.thread)}>
              <AgentHead />
              <main className={styles.threadMain}>
                {threadElement}
                <GoalAutoAdvance />
                <AutomationSessionPicker />
                <PlanRunFinish />
                <PlanRecorder />
                <PlanFileSync />
                <PlanScheduleCard />
                <PromptLibraryManager />
                <PlanAutoOpen
                  isAsideOpen={isAsideOpen}
                  openAside={openAside}
                />
              </main>
            </div>
          </SplitterPane>

          <SplitterHandle
            withHandle
            disableDoubleClick
          />

          <SplitterPane
            id={PLAN_ID}
            defaultSize={PLAN_SIZE}
            min={PLAN_MIN}
            max={PLAN_MAX}
            preservePixel
            resizable={showAside}
            collapsedSize={0}>
            <AgentAside className={styles.planPane} />
          </SplitterPane>
        </Splitter>
      </div>
    </div>
  )
}

export default AgentChat
