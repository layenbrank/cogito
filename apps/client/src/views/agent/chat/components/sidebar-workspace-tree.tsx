import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@i-thinking/design/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@i-thinking/design/components/popover'
import { clsx } from 'clsx'
import dayjs from 'dayjs'

import styles from './sidebar.module.scss'
import { UNGROUPED_WORKSPACE, findWorkspaceIcon } from '@/features/agent/model/workspace'
import type { SidebarSession } from './use-sidebar-branches.ts'
import { useAgentStore } from '@/stores/agent.ts'

interface WorkspaceBranch {
  id: string
  title: string
  icon: string
  color: string
  pinned: boolean
  paths: string[]
  sessions: SidebarSession[]
}

interface SidebarWorkspaceTreeProps {
  branches: WorkspaceBranch[]
  expandedKeySet: Set<string>
  activeSessionID: string | null
  activeWorkspaceID: string | null
  hoverSessionID: string | null
  onHoverSessionChange: (id: string | null) => void
  onExpandedKeysChange: (update: (keys: string[]) => string[]) => void
  onActivateSession: (session: SidebarSession) => void
  onInsertSession: (workspaceID: string) => void
  onRenameSession: (session: SidebarSession) => void
  onRemoveSession: (session: SidebarSession) => void
  onTogglePinned: (session: SidebarSession) => void
  onEditWorkspace: (workspaceID: string) => void
}

function SidebarWorkspaceTree(props: SidebarWorkspaceTreeProps) {
  function findWorkspaceLabel(branch: WorkspaceBranch) {
    const isUngrouped = branch.id === UNGROUPED_WORKSPACE
    return (
      <span className={styles.workspaceTitleInner}>
        {!isUngrouped && branch.color ? (
          <span
            className={styles.workspaceDot}
            style={{ background: branch.color }}
          />
        ) : null}
        <Icon
          icon={findWorkspaceIcon(branch.icon)}
          width={14}
          height={14}
        />
        <span className={styles.workspaceTitle}>{branch.title}</span>
      </span>
    )
  }

  function findWorkspaceExtra(branch: WorkspaceBranch) {
    if (branch.id === UNGROUPED_WORKSPACE) return null
    return (
      <span className={styles.workspaceActions}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className={styles.workspaceAction}
                aria-label="工作区菜单"
              />
            }>
            <Icon
              icon="lucide:ellipsis"
              width={16}
              height={16}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-40">
            <DropdownMenuItem
              onClick={function () {
                void useAgentStore
                  .getState()
                  .toUpdateWorkspace([{ id: branch.id, pinned: !branch.pinned }])
              }}>
              {branch.pinned ? '取消固定' : '固定'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                props.onEditWorkspace(branch.id)
              }}>
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={function () {
                void useAgentStore
                  .getState()
                  .toUpdateWorkspace([{ id: branch.id, archivedAt: Date.now() }])
              }}>
              归档工作区
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-xs"
          className={styles.workspaceAction}
          aria-label="新建会话"
          onClick={function () {
            void props.onInsertSession(branch.id)
          }}>
          <Icon
            icon="lucide:plus"
            width={16}
            height={16}
          />
        </Button>
      </span>
    )
  }

  function findSessionHover(branch: WorkspaceBranch, session: SidebarSession) {
    return (
      <>
        <p className={clsx(styles.hoverTitle, 'line-clamp-2')}>{session.title}</p>
        <span className="text-muted-foreground text-xs">
          {dayjs(session.updatedAt).format('M月D日')}
        </span>
        <span className="text-muted-foreground text-xs">{branch.title}</span>
        {branch.paths.map(function (path) {
          return (
            <span
              key={path}
              className="text-muted-foreground truncate text-xs">
              {path}
            </span>
          )
        })}
      </>
    )
  }

  function findSessionChildren(branch: WorkspaceBranch) {
    if (branch.sessions.length === 0) {
      return <span className={styles.emptySession}>暂无会话</span>
    }
    return (
      <div className="flex flex-col gap-0.5">
        {branch.sessions.map(function (session) {
          const active = props.activeSessionID === session.id
          return (
            <span
              key={session.id}
              className={clsx(styles.sessionRow, active && styles.sessionActive)}>
              <Popover
                open={props.hoverSessionID === session.id}
                onOpenChange={function (open, details) {
                  // 点击用于切换会话，不打开预览；仅悬停打开
                  if (open && details.reason === 'trigger-press') return
                  props.onHoverSessionChange(open ? session.id : null)
                }}>
                <PopoverTrigger
                  openOnHover
                  delay={350}
                  // 点击切会话：挂在 Trigger 上，避免 render 合并时吞掉 Button.onClick
                  onClick={function () {
                    props.onActivateSession(session)
                  }}
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className={styles.sessionMain}
                    />
                  }>
                  <Icon
                    icon="lucide:file-text"
                    className="size-3.5 shrink-0"
                  />
                  <span className={styles.sessionTitle}>{session.title}</span>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  className={styles.hoverCard}>
                  {findSessionHover(branch, session)}
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={styles.sessionMore}
                      aria-label="会话菜单"
                    />
                  }>
                  <Icon
                    icon="lucide:ellipsis"
                    width={16}
                    height={16}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40">
                  <DropdownMenuItem
                    onClick={function () {
                      props.onRenameSession(session)
                    }}>
                    <Icon
                      icon="lucide:pencil"
                      width={14}
                      height={14}
                    />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={function () {
                      props.onTogglePinned(session)
                    }}>
                    <Icon
                      icon={session.pinned ? 'lucide:pin-off' : 'lucide:pin'}
                      width={14}
                      height={14}
                    />
                    {session.pinned ? '取消置顶' : '置顶'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={function () {
                      props.onRemoveSession(session)
                    }}>
                    <Icon
                      icon="lucide:trash-2"
                      width={14}
                      height={14}
                    />
                    移除会话
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          )
        })}
      </div>
    )
  }

  if (props.branches.length === 0) {
    return <p className={styles.empty}>暂无工作区，点击 + 新建</p>
  }

  return (
    <div className={styles.tree}>
      {props.branches.map(function (branch) {
        const isOpen = props.expandedKeySet.has(branch.id)
        return (
          <Collapsible
            key={branch.id}
            open={isOpen}
            onOpenChange={function (open) {
              // 与受控 open 一致时不要写 state，避免 Base UI 同步回调与自动展开互殴
              if (open === isOpen) return
              props.onExpandedKeysChange(function (keys) {
                if (open) {
                  return keys.includes(branch.id) ? keys : [...keys, branch.id]
                }
                if (!keys.includes(branch.id)) return keys
                return keys.filter(function (key) {
                  return key !== branch.id
                })
              })
            }}
            className={clsx(
              styles.branch,
              props.activeWorkspaceID === branch.id && styles.workspaceActive
            )}>
            <div className={styles.workspaceHeader}>
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.workspaceTitleSlot}
                    aria-label={branch.title}
                  />
                }>
                <span className={styles.expandIcon}>
                  <Icon
                    icon={isOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
                    width={16}
                    height={16}
                  />
                </span>
                {findWorkspaceLabel(branch)}
              </CollapsibleTrigger>
              {findWorkspaceExtra(branch)}
            </div>
            <CollapsibleContent className={styles.sessionBody}>
              {findSessionChildren(branch)}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}

export { SidebarWorkspaceTree }
export type { WorkspaceBranch }

