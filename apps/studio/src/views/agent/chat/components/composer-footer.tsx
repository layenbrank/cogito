import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useActiveWorkspace, useActiveWorkspaceID } from '@/features/agent/workspace/client.ts'
import {
  formatUsageCompact,
  useRefreshUsageOnRunEnd,
  useThreadUsage
} from '@/features/chat/usage.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'
import { ChangeSummary } from './change-summary.tsx'

/**
 * 输入框下方：变更汇总（若有）+ 工作区 · 运行位置 · 分支 + 上下文用量。
 * 用量放右端，对齐 client composer footer。
 *
 * 「运行位置」写的是 **Agent 进程在哪跑**（一直是本机），不是模型在哪 ——
 * 模型来源（组织模型 / 我的模型）由输入区右上角的模型选择器表达，别再放一个笼统的「本地」，
 * 那会让人以为在线模型也跑在本地。
 */
export function ComposerFooter() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceID = useActiveWorkspaceID()
  const usage = useThreadUsage()
  const usageLabel = formatUsageCompact(usage)

  // 底栏常驻在对话页，且用量就显示在这里：运行一结束就把账本与配额拉新（见 hook 注释）
  useRefreshUsageOnRunEnd()

  const git = useQuery({
    queryKey: ['workspace', 'git', 'probe', workspaceID],
    queryFn: function () {
      return itc.workspace.git.probe({ workspaceID: workspaceID as string })
    },
    enabled: Boolean(workspaceID),
    staleTime: 15_000
  })

  const branches = useQuery({
    queryKey: ['workspace', 'git', 'branches', workspaceID],
    queryFn: function () {
      return itc.workspace.git.branches({ workspaceID: workspaceID as string })
    },
    enabled: Boolean(workspaceID && git.data?.isRepo),
    staleTime: 30_000
  })

  async function handleCheckout(branch: string) {
    if (!workspaceID || branch === git.data?.branch) return
    try {
      const result = await itc.workspace.git.checkout({ workspaceID, branch })
      await git.refetch()
      await branches.refetch()
      toast.success(`已切换到 ${result.branch}`)
    } catch (error) {
      toast.error(toIpcMessage(error, '切换分支失败'))
    }
  }

  const showGit = Boolean(git.data?.isRepo && git.data.branch)

  return (
    <div className="flex w-full flex-col gap-1">
      <ChangeSummary />

      <div className="text-muted-foreground flex min-h-7 items-center gap-0 px-1 text-xs">
        <div className="flex min-w-0 flex-1 items-center justify-start gap-0">
          <span className="flex max-w-50 min-w-0 items-center gap-1.5 px-2.5 opacity-90">
            <Icon
              icon="lucide:folder"
              className="size-3 shrink-0"
            />
            <span
              className="truncate"
              title={
                activeWorkspace
                  ? (activeWorkspace.primaryPath ?? '（无源文件夹）')
                  : '还没有选择工作区'
              }>
              {activeWorkspace?.title ?? '未选择工作区'}
            </span>
          </span>

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
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="切换分支"
                      className="text-muted-foreground hover:text-foreground h-7 gap-1 rounded-md px-2.5 text-xs"
                    />
                  }>
                  <Icon
                    icon="lucide:git-branch"
                    className="size-3"
                  />
                  <span className="max-w-28 truncate">{git.data?.branch}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-64 overflow-y-auto">
                  {(branches.data?.branches ?? [git.data?.branch].filter(Boolean)).map(
                    function (branch) {
                      if (!branch) return null
                      const isActive = branch === git.data?.branch
                      return (
                        <DropdownMenuItem
                          key={branch}
                          onClick={function () {
                            void handleCheckout(branch)
                          }}>
                          <Icon
                            icon="lucide:check"
                            className={isActive ? 'opacity-100' : 'opacity-0'}
                          />
                          <span className="truncate">{branch}</span>
                        </DropdownMenuItem>
                      )
                    }
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>

        {usageLabel ? (
          <span
            className="text-muted-foreground ms-auto shrink-0 px-1 font-mono text-xs tabular-nums opacity-90"
            title="本会话累计 token（输入 + 输出）">
            {usageLabel} tokens
          </span>
        ) : null}
      </div>
    </div>
  )
}
