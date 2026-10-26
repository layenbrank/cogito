/**
 * Qoder 式左侧栏：工作模式 + 新任务/搜索 + 工作区会话树 + 底栏头像/设置
 *
 * 会话列表的数据与动作都走 assistant-ui 的线程运行时（`aui.threads`）——
 * 工作区仍是本地域（`stores/agent.ts`），会话的归属读线程 `custom.workspaceID`。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
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
import { useSidebarBranches, type SidebarSession } from './use-sidebar-branches.ts'
import { setNextThreadWorkspace } from '@/features/agent/port/draft-workspace'
import { historyPort } from '@/features/agent/port/instance'
import { type ScenarioKey } from '@/features/agent/model/scenarios'
import { useAgentStore } from '@/stores/agent.ts'
import { useSessionStore } from '@/stores/session'

interface SidebarProps {
  className?: string
  scenario: ScenarioKey
  isSearchOpen?: boolean
  searchFocusToken?: number
  onScenarioChange: (scenario: ScenarioKey) => void
  onSearchOpenChange?: (open: boolean) => void
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
  const [sectionOpen, updateSectionOpen] = useState(true)
  const [renaming, updateRenaming] = useState<RenameTarget | null>(null)
  const [renameValue, updateRenameValue] = useState('')
  const [formOpen, updateFormOpen] = useState(false)
  const [editingWorkspaceID, updateEditingWorkspaceID] = useState<string | null>(null)
  const [pendingRemove, updatePendingRemove] = useState<SidebarSession | null>(null)
  const [hoverSessionID, updateHoverSessionID] = useState<string | null>(null)

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
    // 「新的任务」跟随当前激活工作区；工作区节点上的「+」显式带归属。
    // 一个工作区都没有时不再拦人去新建：会话落在「未分组」。
    const targetID =
      workspaceID === undefined ? (activeWorkspaceID ?? workspaces[0]?.id ?? null) : workspaceID
    if (targetID) useAgentStore.getState().toActivateWorkspace(targetID)
    // 归属记在落库那一刻用：先把这次点击选的归属存好，再种新会话
    setNextThreadWorkspace(targetID ?? null)
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
          新的任务
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
      </div>

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
