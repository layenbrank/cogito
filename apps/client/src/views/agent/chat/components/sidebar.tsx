/**
 * Qoder 式左侧栏：工作模式 + 新建会话/搜索/任务 + 工作区会话树 + 底栏头像/设置。
 *
 * 「任务」快捷钮 → 右栏任务定义；「自动化」分组 → 执行产生的会话（可回看，徽标回链任务）。
 * 会话列表走 assistant-ui 线程运行时；工作区仍是本地域（`stores/agent.ts`）。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { BackgroundInbox } from '@cogito/design/assistant/background-inbox.aui'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { SessionSearch } from './session-search'
import styles from './sidebar.module.scss'
import { SidebarRenameDialog, SidebarRemoveDialog } from './sidebar-dialogs.tsx'
import { SidebarProfileBar } from './sidebar-profile-bar.tsx'
import { SidebarScenarioNav } from './sidebar-scenario-nav.tsx'
import { SidebarWorkspaceTree } from './sidebar-workspace-tree.tsx'
import { WorkspaceForm } from './workspace-form'
import { useBackgroundRuns } from './use-background-runs'
import { useSidebarBranches, type SidebarSession } from './use-sidebar-branches.ts'
import { clearFinishedRun } from '@/features/agent/acp/run-state'
import { subscribeAutomationSession } from '@/features/automation/events'
import { rememberNextThreadWorkspace } from '@/features/agent/port/draft-workspace'
import { historyPort } from '@/features/agent/port/instance'
import { type ScenarioKey } from '@/features/agent/model/scenarios'
import { useAgentStore } from '@/stores/agent.ts'
import { useAutomationStore } from '@/stores/automation'
import { useSessionStore } from '@/stores/session'
import { openAsideTasks } from '@/views/agent/chat/components/open-aside-tasks'

interface SidebarProps {
  className?: string
  scenario: ScenarioKey
  isSearchOpen?: boolean
  searchFocusToken?: number
  onScenarioChange: (scenario: ScenarioKey) => void
  onSearchOpenChange?: (open: boolean) => void
  /** 打开右栏「任务」（定义/启停/记录）；与侧栏「自动化」会话分组分工 */
  onOpenTasks: () => void
  onOpenSettings: (section?: string) => void
}

interface RenameTarget {
  id: string
  title: string
}

function AgentSidebar(props: SidebarProps) {
  const aui = useAui()
  const activeThreadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const activeWorkspaceID = useAgentStore(function (state) {
    return state.activeWorkspaceID
  })
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const user = useSessionStore(function (state) {
    return state.user
  })

  const branchState = useSidebarBranches()
  const backgroundRuns = useBackgroundRuns()
  const sessionTasks = useAutomationStore(function (state) {
    return state.sessionTasks
  })
  const hydrateSessionTasks = useAutomationStore(function (state) {
    return state.hydrateSessionTasks
  })
  const [sectionOpen, updateSectionOpen] = useState(true)
  const [automationOpen, updateAutomationOpen] = useState(true)
  const [renaming, updateRenaming] = useState<RenameTarget | null>(null)
  const [renameValue, updateRenameValue] = useState('')
  const [formOpen, updateFormOpen] = useState(false)
  const [editingWorkspaceID, updateEditingWorkspaceID] = useState<string | null>(null)
  const [pendingRemove, updatePendingRemove] = useState<SidebarSession | null>(null)
  const [hoverSessionID, updateHoverSessionID] = useState<string | null>(null)

  useEffect(
    function () {
      return subscribeAutomationSession(function () {
        void aui.threads.reload().catch(function (error: unknown) {
          console.warn('[agent/sidebar] 刷新自动化会话列表失败:', error)
        })
        void useAgentStore.getState().toReadSessions()
      })
    },
    [aui]
  )

  useEffect(
    function () {
      if (branchState.automationSessions.length === 0) return
      // 冷启动 / 刷新后补会话→任务映射，方便回链任务定义
      void hydrateSessionTasks()
    },
    [branchState.automationSessions.length, hydrateSessionTasks]
  )

  const isSearchOpen = Boolean(props.isSearchOpen)
  const displayName = user?.username || '未登录'

  useEffect(
    function () {
      if (!props.searchFocusToken) return
      props.onSearchOpenChange?.(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.searchFocusToken]
  )

  function handleActivateSession(session: Pick<SidebarSession, 'id' | 'workspaceID'>) {
    if (session.workspaceID) {
      useAgentStore.getState().toActivateWorkspace(session.workspaceID)
    }
    try {
      aui.threads.switchToThread(session.id)
    } catch (error) {
      console.error('[agent/sidebar] 切换会话失败:', session.id, error)
      toast.error(error instanceof Error ? error.message : '切换会话失败')
    }
  }

  function handleInsertSession(workspaceID?: string | null) {
    // 「新建会话」跟随当前激活工作区；工作区节点上的「+」显式带归属。
    // 一个工作区都没有时不再拦人去新建：会话落在「未分组」。
    const targetID =
      workspaceID === undefined ? (activeWorkspaceID ?? workspaces[0]?.id ?? null) : workspaceID
    if (targetID) useAgentStore.getState().toActivateWorkspace(targetID)
    // 归属记在落库那一刻用：先把这次点击选的归属存好，再种新会话
    rememberNextThreadWorkspace(targetID ?? null)
    aui.threads.switchToNewThread()
    if (!sectionOpen) updateSectionOpen(true)
    if (targetID && !branchState.expandedKeys.includes(targetID)) {
      branchState.updateExpandedKeys(function (keys) {
        return [...keys, targetID]
      })
    }
  }

  function handleToggleSearch() {
    props.onSearchOpenChange?.(!isSearchOpen)
  }

  function handleCloseSearch() {
    props.onSearchOpenChange?.(false)
  }

  function handleOpenBackgroundRun(id: string) {
    clearFinishedRun(id)
    try {
      aui.threads.switchToThread(id)
    } catch (error) {
      console.error('[agent/sidebar] 切换后台会话失败:', id, error)
      toast.error(error instanceof Error ? error.message : '切换会话失败')
    }
  }

  function handleRename() {
    if (!renaming) return
    const title = renameValue.trim()
    if (title) {
      aui.threads.item({ id: renaming.id }).rename(title)
    }
    updateRenaming(null)
  }

  function handleRemoveSession() {
    const target = pendingRemove
    updatePendingRemove(null)
    if (!target) return
    aui.threads.item({ id: target.id }).delete()
  }

  async function handleTogglePinned(session: SidebarSession) {
    await historyPort.updateThread(session.id, { pinned: !session.pinned })
    // pinned 只经列表适配器的 `custom` 发布，改了落库值后重载一次列表让它回到列表项上
    await aui.threads.reload()
  }

  return (
    <div className={clsx(styles.root, props.className)}>
      <SidebarScenarioNav
        scenario={props.scenario}
        isSearchOpen={isSearchOpen}
        onScenarioChange={props.onScenarioChange}
        onToggleSearch={handleToggleSearch}
      />

      {backgroundRuns.length > 0 ? (
        <BackgroundInbox
          runs={backgroundRuns}
          onOpen={handleOpenBackgroundRun}
          className="border-border/50 mb-1 border-b pb-1"
        />
      ) : null}

      <div className={`${styles.quickActions} flex flex-col gap-0.5`}>
        <Button
          type="button"
          variant="ghost"
          className={styles.quickAction}
          onClick={function () {
            handleInsertSession()
          }}>
          <Icon
            icon="lucide:plus"
            width={15}
            height={15}
          />
          新建会话
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={clsx(styles.quickAction, isSearchOpen && styles.quickActionActive)}
          onClick={handleToggleSearch}>
          <Icon
            icon="lucide:search"
            width={15}
            height={15}
          />
          搜索
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={styles.quickAction}
          onClick={props.onOpenTasks}>
          <Icon
            icon="lucide:calendar-clock"
            width={15}
            height={15}
          />
          任务
        </Button>
      </div>

      {branchState.automationSessions.length > 0 ? (
        <div className={`${styles.section} flex shrink-0 flex-col`}>
          <div className={`${styles.sectionHeader} flex items-center justify-between gap-1`}>
            <Button
              variant="ghost"
              className={styles.sectionTitle}
              onClick={function () {
                updateAutomationOpen(function (open) {
                  return !open
                })
              }}>
              自动化
            </Button>
            <span className="text-muted-foreground pr-1 text-[11px]">
              {branchState.automationSessions.length}
            </span>
          </div>
          {automationOpen ? (
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto overscroll-y-contain px-0.5 pb-1">
              {branchState.automationSessions.map(function (session) {
                const active = activeThreadID === session.id
                const taskId = sessionTasks[session.id]
                return (
                  <div
                    key={session.id}
                    className={clsx(
                      'flex items-center gap-0.5',
                      active && styles.sessionActive
                    )}>
                    <Button
                      type="button"
                      variant="ghost"
                      className={clsx(styles.sessionMain, 'min-w-0 flex-1')}
                      onClick={function () {
                        handleActivateSession(session)
                      }}>
                      <Icon
                        icon="lucide:calendar-clock"
                        className="size-3.5 shrink-0"
                      />
                      <span className={styles.sessionTitle}>{session.title}</span>
                      {session.isRunning ? (
                        <Icon
                          icon="lucide:loader-2"
                          className="text-muted-foreground size-3.5 shrink-0 animate-spin"
                          aria-label="正在执行"
                        />
                      ) : null}
                    </Button>
                    {taskId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground me-1 size-6 shrink-0"
                        aria-label="查看任务定义"
                        title="查看任务定义"
                        onClick={function () {
                          openAsideTasks(taskId)
                        }}>
                        <Icon
                          icon="lucide:list-todo"
                          className="size-3.5"
                        />
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`${styles.section} flex min-h-0 flex-1 flex-col`}>
        <div className={`${styles.sectionHeader} flex items-center justify-between gap-1`}>
          <Button
            variant="ghost"
            className={styles.sectionTitle}
            onClick={function () {
              updateSectionOpen(function (open) {
                return !open
              })
            }}>
            工作区
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={styles.sectionAdd}
            aria-label="新建工作区"
            onClick={function () {
              updateEditingWorkspaceID(null)
              updateFormOpen(true)
            }}>
            <Icon
              icon="lucide:plus"
              width={16}
              height={16}
            />
          </Button>
        </div>

        {sectionOpen ? (
          <SidebarWorkspaceTree
            branches={branchState.branches}
            expandedKeySet={branchState.expandedKeySet}
            activeSessionID={activeThreadID}
            activeWorkspaceID={activeWorkspaceID}
            hoverSessionID={hoverSessionID}
            onHoverSessionChange={updateHoverSessionID}
            onExpandedKeysChange={branchState.updateExpandedKeys}
            onActivateSession={handleActivateSession}
            onInsertSession={function (workspaceID) {
              handleInsertSession(workspaceID)
            }}
            onRenameSession={function (session) {
              updateRenameValue(session.title)
              updateRenaming({ id: session.id, title: session.title })
            }}
            onRemoveSession={updatePendingRemove}
            onTogglePinned={function (session) {
              void handleTogglePinned(session)
            }}
            onEditWorkspace={function (workspaceID) {
              updateEditingWorkspaceID(workspaceID)
              updateFormOpen(true)
            }}
          />
        ) : null}
      </div>

      <SidebarProfileBar
        displayName={displayName}
        avatarUrl={user?.avatarUrl}
        onOpenSettings={props.onOpenSettings}
      />

      <SidebarRenameDialog
        open={Boolean(renaming)}
        value={renameValue}
        onValueChange={updateRenameValue}
        onClose={function () {
          updateRenaming(null)
        }}
        onConfirm={function () {
          handleRename()
        }}
      />

      <SidebarRemoveDialog
        session={pendingRemove}
        onClose={function () {
          updatePendingRemove(null)
        }}
        onConfirm={function () {
          handleRemoveSession()
        }}
      />

      <SessionSearch
        open={isSearchOpen}
        onClose={handleCloseSearch}
        onSelect={handleActivateSession}
      />

      <WorkspaceForm
        open={formOpen}
        workspaceID={editingWorkspaceID}
        onClose={function () {
          updateFormOpen(false)
          updateEditingWorkspaceID(null)
        }}
      />
    </div>
  )
}

export { AgentSidebar }
