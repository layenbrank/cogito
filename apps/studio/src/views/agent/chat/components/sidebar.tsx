import { Icon } from '@iconify/react/offline'
import { ThreadListPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import { ThreadListItem, ThreadListSearch } from '@cogito/design/assistant/thread-list.aui'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { AccountMenu } from '@/features/account/account-menu.tsx'
import {
  useActiveWorkspaceID,
  useArchivedWorkspaces,
  useWorkspaceActions,
  useWorkspaces,
  type Workspace
} from '@/features/agent/workspace/client.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'
import { findSidebarState, writeSidebarState, type SidebarState } from './sidebar-expansion.ts'
import { useWorkspaceThreadGroups } from './thread-groups.ts'
import { ProfileMenu } from './profile-menu.tsx'
import { QuotaMenu } from './quota-menu.tsx'
import { ICON_MAP, WorkspaceForm } from './workspace-form.tsx'

interface SidebarProps {
  onOpenSettings: () => void
  /** 递增它把焦点送到搜索框（`⌘F`）；从 0 开始，所以 0 表示“还没按过” */
  searchFocusToken?: number
}

/**
 * 左栏（导航）：新任务 / 搜索 + 工作区 Collapse 树 → 会话 + 已归档区 + 底栏头像/设置。
 *
 * 工作区**默认全部展开**：进来就能看见每个工作区下的任务，不用先点开一层。用户手动折叠过的
 * 那个工作区保持折叠（`expanded` 里存的是显式选择），所以这里不能用「受控 + 一次性初始化」的写法，
 * 只能按 `undefined` 表示「还没表过态」来兜默认值 —— 记忆部分见 `sidebar-expansion.ts`。
 *
 * 归档工作区单独一段（默认收起）：不再参与「当前工作区」指针，也不给选中入口 ——
 * 主进程对归档工作区的读写一律拒绝，做了入口只会换来一串报错。它的会话仍然挂在它名下。
 *
 * 入口唯一性：设置页只从底部齿轮菜单的「设置」进去。
 */
export default function AgentSidebar(props: SidebarProps) {
  const labels = useAssistantLabels()
  const aui = useAui()
  const [search, updateSearch] = useState('')
  const [formOpen, updateFormOpen] = useState(false)
  const [editingID, updateEditingID] = useState<string | null>(null)
  const [sidebarState, updateSidebarState] = useState<SidebarState>(findSidebarState)
  const isLoading = useAuiState(function (state) {
    return state.threads.isLoading
  })
  const workspaces = useWorkspaces()
  const archived = useArchivedWorkspaces()
  const activeWorkspaceID = useActiveWorkspaceID()
  const { selectWorkspace, pinWorkspace, archiveWorkspace, restoreWorkspace } =
    useWorkspaceActions()
  const isSearching = search.trim().length > 0
  const searchRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(
    function () {
      return toSortedWorkspaces(workspaces.data ?? [])
    },
    [workspaces.data]
  )

  const archivedRows = useMemo(
    function () {
      return toSortedWorkspaces(archived.data ?? [])
    },
    [archived.data]
  )

  // 归档工作区也参与分组：它的会话要落在自己名下，而不是「未关联」
  const { threadIds, groups } = useWorkspaceThreadGroups(search, archivedRows)

  const indicesByWorkspace = useMemo(
    function () {
      const map = new Map<string, number[]>()
      for (const group of groups) map.set(group.id, group.indices)
      return map
    },
    [groups]
  )

  useEffect(
    function () {
      writeSidebarState(sidebarState)
    },
    [sidebarState]
  )

  useEffect(
    function () {
      if (!props.searchFocusToken) return
      searchRef.current?.focus()
      searchRef.current?.select()
    },
    [props.searchFocusToken]
  )

  function setExpanded(id: string, next: boolean) {
    updateSidebarState(function (prev) {
      return { ...prev, expanded: { ...prev.expanded, [id]: next } }
    })
  }

  function setArchivedOpen(next: boolean) {
    updateSidebarState(function (prev) {
      return { ...prev, archivedOpen: next }
    })
  }

  function openCreate() {
    updateEditingID(null)
    updateFormOpen(true)
  }

  function openEdit(id: string) {
    updateEditingID(id)
    updateFormOpen(true)
  }

  async function handlePin(item: Workspace) {
    try {
      await pinWorkspace.mutateAsync({ id: item.id, pinned: !item.pinned })
    } catch (error) {
      toast.error(toIpcMessage(error, '固定失败'))
    }
  }

  async function handleArchive(id: string) {
    try {
      await archiveWorkspace.mutateAsync(id)
      toast.success('已归档工作区')
    } catch (error) {
      toast.error(toIpcMessage(error, '归档失败'))
    }
  }

  async function handleRestore(id: string) {
    try {
      await restoreWorkspace.mutateAsync(id)
      toast.success('已恢复工作区')
    } catch (error) {
      toast.error(toIpcMessage(error, '恢复失败'))
    }
  }

  /**
   * 在这里只**切指针 + 开空会话**，不钉住归属：会话行要到首条消息才落库，归属按那一刻的
   * 活跃工作区算（与运行时的沙箱根同一口径）。所以中途又切了工作区，这个任务就跟着走
   * —— 这是刻意的：归属随运行上下文，而不是随点按钮那一刻的界面。
   */
  function handleNewThreadIn(workspaceID: string) {
    void selectWorkspace.mutateAsync(workspaceID).then(function () {
      void aui.threads.switchToNewThread()
    })
  }

  const unboundIndices = indicesByWorkspace.get('__unbound__') ?? []

  return (
    <aside
      data-slot="agent-sidebar"
      className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 flex-col px-2.5 pt-2.5 pb-2">
      <div className="mb-2 flex flex-col gap-1">
        <ThreadListPrimitive.New asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hover:bg-muted h-8 w-full justify-start gap-1.5 rounded-md px-2 text-sm font-medium">
            <Icon
              icon="lucide:plus"
              className="size-4"
            />
            {labels.newThread}
          </Button>
        </ThreadListPrimitive.New>
        <ThreadListSearch
          ref={searchRef}
          value={search}
          onValueChange={updateSearch}
          className="bg-muted/50 border-transparent h-8 rounded-md text-xs shadow-none"
        />
      </div>

      <div className="border-border/70 mb-1 flex items-center justify-between border-t pt-2">
        <span className="text-muted-foreground px-1.5 text-xs font-medium">工作区</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="hover:bg-muted size-7 rounded-md"
          aria-label="新建工作区"
          title="新建工作区"
          onClick={openCreate}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1">
        {isLoading ? <p className="text-muted-foreground px-2 pt-3 text-xs">加载中…</p> : null}

        {rows.map(function (item) {
          const indices = indicesByWorkspace.get(item.id) ?? []

          return (
            <WorkspaceRow
              key={item.id}
              item={item}
              isOpen={sidebarState.expanded[item.id] ?? true}
              isActive={item.id === activeWorkspaceID}
              taskCount={indices.length}
              onToggle={function (next) {
                setExpanded(item.id, next)
              }}
              onSelect={function () {
                void selectWorkspace.mutateAsync(item.id)
                setExpanded(item.id, true)
              }}
              actions={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100"
                    aria-label="在此工作区新建任务"
                    title="新建任务"
                    onClick={function () {
                      handleNewThreadIn(item.id)
                    }}>
                    <Icon
                      icon="lucide:plus"
                      className="size-3.5"
                    />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 group-hover:opacity-100"
                          aria-label="工作区菜单"
                        />
                      }>
                      <Icon
                        icon="lucide:ellipsis"
                        className="size-3.5"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={function () {
                          openEdit(item.id)
                        }}>
                        编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={function () {
                          void handlePin(item)
                        }}>
                        {item.pinned ? '取消固定' : '固定'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={function () {
                          void handleArchive(item.id)
                        }}>
                        归档
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }>
              <ThreadIndices
                threadIds={threadIds}
                indices={indices}
              />
              {!isLoading && indices.length === 0 && !isSearching ? (
                <p className="text-muted-foreground px-2.5 py-1.5 text-xs italic">还没有任务</p>
              ) : null}
            </WorkspaceRow>
          )
        })}

        {unboundIndices.length > 0 ? (
          <div className="mt-2">
            <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">未关联工作区</p>
            <ThreadIndices
              threadIds={threadIds}
              indices={unboundIndices}
            />
          </div>
        ) : null}

        {!isLoading && rows.length === 0 ? (
          <p className="text-muted-foreground px-2.5 pt-3 text-xs italic leading-relaxed">
            {isSearching ? '没有匹配的任务' : '还没有工作区，点上方 + 新建一个'}
          </p>
        ) : null}

        {archivedRows.length > 0 ? (
          <Collapsible
            open={sidebarState.archivedOpen}
            onOpenChange={setArchivedOpen}>
            <div className="border-border/70 mt-2 flex min-h-7.5 items-center gap-0.5 border-t pt-1">
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground shrink-0"
                    aria-label={sidebarState.archivedOpen ? '收起已归档' : '展开已归档'}>
                    <Icon
                      icon="lucide:chevron-right"
                      className={
                        sidebarState.archivedOpen
                          ? 'size-3.5 rotate-90 transition-transform'
                          : 'size-3.5 transition-transform'
                      }
                    />
                  </Button>
                }
              />
              <span className="text-muted-foreground px-1 text-xs font-medium">
                已归档（{archivedRows.length}）
              </span>
            </div>

            <CollapsibleContent className="flex flex-col gap-0.5">
              {archivedRows.map(function (item) {
                const indices = indicesByWorkspace.get(item.id) ?? []

                return (
                  <WorkspaceRow
                    key={item.id}
                    item={item}
                    isOpen={sidebarState.expanded[item.id] ?? false}
                    isActive={false}
                    taskCount={indices.length}
                    onToggle={function (next) {
                      setExpanded(item.id, next)
                    }}
                    actions={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                        aria-label={`恢复 ${item.title}`}
                        title="恢复工作区"
                        disabled={restoreWorkspace.isPending}
                        onClick={function () {
                          void handleRestore(item.id)
                        }}>
                        <Icon
                          icon="lucide:archive-restore"
                          className="size-3.5"
                        />
                      </Button>
                    }>
                    <ThreadIndices
                      threadIds={threadIds}
                      indices={indices}
                    />
                    {indices.length === 0 ? (
                      <p className="text-muted-foreground px-2.5 py-1.5 text-xs italic">没有任务</p>
                    ) : null}
                  </WorkspaceRow>
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>

      <div className="border-border/70 mt-auto flex items-center gap-2 border-t pt-2">
        <AccountMenu onOpenSettings={props.onOpenSettings} />
        <QuotaMenu />
        <ProfileMenu onOpenSettings={props.onOpenSettings} />
      </div>

      <WorkspaceForm
        open={formOpen}
        workspaceID={editingID}
        onOpenChange={updateFormOpen}
      />
    </aside>
  )
}

interface WorkspaceRowProps {
  item: Workspace
  isOpen: boolean
  isActive: boolean
  /** 该工作区名下的任务数（名字右侧的小计数） */
  taskCount: number
  onToggle: (next: boolean) => void
  /** 省略 = 不可选中（归档工作区走这条：主进程拒绝它的读写） */
  onSelect?: () => void
  /** 行尾动作：活跃工作区是「新建任务 + 菜单」，归档工作区只有「恢复」 */
  actions: ReactNode
  children: ReactNode
}

/** 一行工作区（活跃 / 归档共用）：折叠头 + 名下任务列表 */
function WorkspaceRow(props: WorkspaceRowProps) {
  const { item, isOpen, isActive, taskCount, onToggle, onSelect, actions, children } = props
  const glyph = ICON_MAP[item.icon] ?? 'lucide:folder'
  const titleClass = isActive
    ? 'min-w-0 flex-1 truncate text-xs font-semibold'
    : 'min-w-0 flex-1 truncate text-xs font-medium'
  const avatar = (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded text-white"
      style={{ backgroundColor: item.color }}>
      <Icon
        icon={glyph}
        className="size-3"
      />
    </span>
  )
  const body = (
    <>
      {avatar}
      <span className={titleClass}>{item.title}</span>
      {taskCount > 0 ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{taskCount}</span>
      ) : null}
      {item.pinned ? (
        <Icon
          icon="lucide:pin"
          className="text-muted-foreground size-3 shrink-0"
        />
      ) : null}
    </>
  )

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={onToggle}>
      <div
        data-active={isActive ? 'true' : 'false'}
        className="hover:bg-muted/60 data-[active=true]:bg-muted/80 group flex min-h-8.5 items-center gap-0.5 rounded-lg px-0.5">
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground shrink-0"
              aria-label={isOpen ? '折叠' : '展开'}>
              <Icon
                icon="lucide:chevron-right"
                className={
                  isOpen
                    ? 'size-3.5 rotate-90 transition-transform'
                    : 'size-3.5 transition-transform'
                }
              />
            </Button>
          }
        />

        {onSelect ? (
          <Button
            type="button"
            variant="ghost"
            className="hover:bg-transparent h-auto min-w-0 flex-1 justify-start gap-1.5 py-1.5 pe-1 text-xs"
            title={item.primaryPath ?? item.title}
            onClick={onSelect}>
            {body}
          </Button>
        ) : (
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pe-1 text-xs opacity-70"
            title={item.primaryPath ?? item.title}>
            {body}
          </span>
        )}

        {actions}
      </div>

      <CollapsibleContent className="flex flex-col gap-0.5 ps-4.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** 分组里的一串会话：下标是 `threadIds` 的位置（`ItemByIndex` 要的就是它） */
function ThreadIndices(props: { threadIds: readonly string[]; indices: readonly number[] }) {
  return (
    <>
      {props.indices.map(function (index) {
        return (
          <ThreadListPrimitive.ItemByIndex
            key={props.threadIds[index]}
            index={index}
            components={{ ThreadListItem }}
          />
        )
      })}
    </>
  )
}

/** 组的先后就是列表的先后：固定在前，再看手工排序 */
function toSortedWorkspaces(rows: readonly Workspace[]): Workspace[] {
  return [...rows].sort(function (a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return a.sort - b.sort
  })
}
