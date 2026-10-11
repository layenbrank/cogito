/**
 * Qoder 式左侧栏：工作模式 + 新任务/搜索 + 工作区会话树 + 底栏头像/设置
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { v4 as UUIDV4 } from 'uuid'

import { SessionSearch } from './session-search'
import styles from './sidebar.module.scss'
import { SidebarRenameDialog, SidebarRemoveDialog } from './sidebar-dialogs.tsx'
import { SidebarProfileBar } from './sidebar-profile-bar.tsx'
import { SidebarScenarioNav } from './sidebar-scenario-nav.tsx'
import { SidebarWorkspaceTree } from './sidebar-workspace-tree.tsx'
import { WorkspaceForm } from './workspace-form'
import { type ScenarioKey } from '@/features/agent/model/scenarios'
import { useAgentStore, type AiSession } from '@/stores/agent.ts'
import { useSessionStore } from '@/stores/session'
import { useSidebarBranches } from './use-sidebar-branches.ts'

interface SidebarProps {
  className?: string
  scenario: ScenarioKey
  isSearchOpen?: boolean
  searchFocusToken?: number
  onScenarioChange: (scenario: ScenarioKey) => void
  onSearchOpenChange?: (open: boolean) => void
  onOpenSettings: () => void
}

interface RenameTarget {
  id: string
  title: string
}

function AgentSidebar(props: SidebarProps) {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
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
  const [pendingRemove, updatePendingRemove] = useState<AiSession | null>(null)
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

  function handleActivateSession(session: AiSession) {
    if (session.workspaceID) {
      useAgentStore.getState().toActivateWorkspace(session.workspaceID)
    }
    useAgentStore.getState().toReadSession(session.id)
    void useAgentStore.getState().toReadMessages(session.id)
  }

  async function handleInsertSession(workspaceID?: string | null) {
    let targetID = workspaceID ?? activeWorkspaceID
    if (!targetID) {
      targetID = workspaces[0]?.id ?? null
    }
    if (!targetID) {
      toast.info('请先新建工作区')
      updateEditingWorkspaceID(null)
      updateFormOpen(true)
      return
    }
    const sessionID = UUIDV4()
    const now = Date.now()
    await useAgentStore.getState().toWriteSession([
      {
        id: sessionID,
        title: '新对话',
        pinned: false,
        workspaceID: targetID,
        createdAt: now,
        updatedAt: now
      }
    ])
    handleActivateSession({
      id: sessionID,
      title: '新对话',
      pinned: false,
      workspaceID: targetID,
      createdAt: now,
      updatedAt: now
    })
    if (!sectionOpen) updateSectionOpen(true)
    if (!branchState.expandedKeys.includes(targetID)) {
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

  async function handleRename() {
    if (!renaming) return
    const title = renameValue.trim()
    if (title) {
      await useAgentStore.getState().toUpdateSession([{ id: renaming.id, title }])
    }
    updateRenaming(null)
  }

  async function handleRemoveSession() {
    const target = pendingRemove
    updatePendingRemove(null)
    if (!target) return
    await useAgentStore.getState().toRemoveSession([target.id])
  }

  return (
    <div className={clsx(styles.root, props.className)}>
      <SidebarScenarioNav
        scenario={props.scenario}
        isSearchOpen={isSearchOpen}
        onScenarioChange={props.onScenarioChange}
        onToggleSearch={handleToggleSearch}
      />

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
              icon="mdi:plus"
              width={16}
              height={16}
            />
          </Button>
        </div>

        {sectionOpen ? (
          <SidebarWorkspaceTree
            branches={branchState.branches}
            expandedKeySet={branchState.expandedKeySet}
            activeSessionID={activeSessionID}
            activeWorkspaceID={activeWorkspaceID}
            hoverSessionID={hoverSessionID}
            onHoverSessionChange={updateHoverSessionID}
            onExpandedKeysChange={branchState.updateExpandedKeys}
            onActivateSession={handleActivateSession}
            onInsertSession={function (workspaceID) {
              void handleInsertSession(workspaceID)
            }}
            onRenameSession={function (session) {
              updateRenameValue(session.title)
              updateRenaming({ id: session.id, title: session.title })
            }}
            onRemoveSession={updatePendingRemove}
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
          void handleRename()
        }}
      />

      <SidebarRemoveDialog
        session={pendingRemove}
        onClose={function () {
          updatePendingRemove(null)
        }}
        onConfirm={function () {
          void handleRemoveSession()
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
export type { SidebarProps }
