/**
 * 输入框下方：工作区 / 文件夹 · 本机运行 · 分支（对齐 Qoder footer）。
 *
 * 工作区与「当前文件夹」都在这里可切；分支切换走 agent 共享的 Git 动作层，
 * 因此审阅 / 文件 / 历史面板会一起更新（不再各拉各的）。
 */
import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import {
  Context,
  ContextContent,
  ContextContentHeader,
  ContextTrigger
} from '@cogito/design/assistant/context'
import { cn } from 'cn'
import { useSyncExternalStore } from 'react'

import {
  findGooseUsage,
  formatGooseUsage,
  subscribeGooseUsage,
  type GooseUsage
} from '@/features/agent/acp/goose-usage'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { checkoutNow, useWorkspaceGitSnapshot } from '@/features/agent/workspace/git.ts'
import { useAgentStore } from '@/stores/agent.ts'
import { BranchSwitcherView } from '@/views/code/workspace/scm/branch-switcher-view.tsx'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'

/**
 * 当前会话的上下文窗口用量（ACP usage_update → goose-usage）。
 * assistant-ui 的 `mainThreadId` 与 ACP 的 threadID 同源，直接用它取当前会话用量。
 */
function useContextUsage(): GooseUsage | null {
  const activeThreadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  return useSyncExternalStore(
    subscribeGooseUsage,
    function () {
      return findGooseUsage(activeThreadID)
    }
  )
}

/** footer 右侧的用量展示：`12k / 128k`，点开看占比 */
function UsageDisplay() {
  const usage = useContextUsage()
  if (!usage || usage.size <= 0) return null
  return (
    <Context usedTokens={usage.used} maxTokens={usage.size}>
      <ContextTrigger>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-7 gap-1 rounded-md px-2.5 text-xs"
          title={`上下文窗口 ${formatGooseUsage(usage)}`}>
          <Icon
            icon="lucide:database"
            className="size-3 shrink-0"
          />
          <span className="font-mono tabular-nums">{formatGooseUsage(usage)}</span>
        </Button>
      </ContextTrigger>
      <ContextContent
        align="end"
        side="top"
        sideOffset={8}>
        <ContextContentHeader />
      </ContextContent>
    </Context>
  )
}

/**
 * 工作区 + 当前文件夹：一个下拉同时管两件事 ——
 * 换工作区（含它自己的文件夹列表），或在当前工作区里换文件夹。
 */
function WorkspaceMenu() {
  const { workspace, workspaceID, rootPath, folders, selectRoot } = useActiveWorkspace()
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const currentFolderName =
    rootPath && folders.length > 1 ? findBaseName(rootPath) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="切换工作区或文件夹"
            title={rootPath ?? '还没有选择工作区'}
            className="text-muted-foreground hover:text-foreground h-7 max-w-50 min-w-0 gap-1.5 rounded-md px-2.5 text-xs"
          />
        }>
        <Icon
          icon="lucide:folder"
          className="size-3 shrink-0"
        />
        <span className="min-w-0 truncate">{workspace?.title ?? '未选择工作区'}</span>
        {currentFolderName ? (
          <span className="text-muted-foreground/80 min-w-0 truncate">/ {currentFolderName}</span>
        ) : null}
        <Icon
          icon="lucide:chevrons-up-down"
          className="size-3 shrink-0 opacity-55"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="max-h-80 w-auto min-w-56 max-w-80 overflow-y-auto p-1">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
            工作区
          </DropdownMenuLabel>
          {workspaces.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">还没有工作区</p>
          ) : null}
          {workspaces.map(function (item) {
            const isActive = item.id === workspaceID
            return (
              <DropdownMenuItem
                key={item.id}
                title={item.title}
                className={cn('gap-2 rounded-sm px-2 py-2 text-sm', isActive && 'bg-accent/60')}
                onClick={function () {
                  if (isActive) return
                  useAgentStore.getState().toActivateWorkspace(item.id)
                }}>
                <Icon
                  icon="lucide:check"
                  className={cn(
                    'size-4 shrink-0',
                    isActive ? 'text-primary opacity-100' : 'opacity-0'
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>

        {folders.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
                文件夹
              </DropdownMenuLabel>
              {folders.map(function (folder) {
                const isActive = folder.path === rootPath
                return (
                  <DropdownMenuItem
                    key={folder.id}
                    title={folder.path}
                    className={cn('gap-2 rounded-sm px-2 py-2 text-sm', isActive && 'bg-accent/60')}
                    onClick={function () {
                      if (isActive) return
                      selectRoot(folder.path)
                    }}>
                    <Icon
                      icon="lucide:check"
                      className={cn(
                        'size-4 shrink-0',
                        isActive ? 'text-primary opacity-100' : 'opacity-0'
                      )}
                    />
                    <Icon
                      icon="lucide:folder"
                      className="text-muted-foreground size-4 shrink-0 opacity-70"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {findBaseName(folder.path)}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ComposerFooter() {
  const { rootPath } = useActiveWorkspace()
  const snapshot = useWorkspaceGitSnapshot(rootPath)
  const showGit = snapshot.isRepo && Boolean(snapshot.branch)

  return (
    <div className="text-muted-foreground flex min-h-7 w-full items-center gap-0 px-1 text-xs">
      <div className="flex min-w-0 flex-1 items-center justify-start gap-0">
        <WorkspaceMenu />

        <span
          aria-hidden
          className="bg-border mx-0.5 h-3.5 w-px shrink-0"
        />

        <span
          className="flex shrink-0 items-center gap-1.5 px-2.5 opacity-90"
          title="Agent 在本机运行，工作区文件不出本机；模型请求按所选 provider 发出">
          <Icon
            icon="lucide:hard-drive"
            className="size-3 shrink-0"
          />
          本机运行
        </span>

        {showGit ? (
          <>
            <span
              aria-hidden
              className="bg-border mx-0.5 h-3.5 w-px shrink-0"
            />
            <BranchSwitcherView
              branch={snapshot.branch}
              locals={snapshot.branches?.branches ?? []}
              remotes={snapshot.branches?.remotes ?? []}
              ahead={snapshot.ahead}
              behind={snapshot.behind}
              isBusy={snapshot.isPending}
              size="sm"
              tone="header"
              className="max-w-56"
              onCheckout={function (name, fromRemote) {
                void checkoutNow(rootPath, name, fromRemote)
              }}
            />
          </>
        ) : null}
      </div>

      <UsageDisplay />
    </div>
  )
}

export { ComposerFooter }
