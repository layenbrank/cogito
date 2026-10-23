import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { CHANNELS } from '@/shared/ipc/channels'

interface ProbeR {
  isRepo: boolean
  branch: string | null
}

interface BranchesR {
  current: string
  branches: string[]
}

/**
 * 输入框下方：工作区 · 本机运行 · 分支（对齐 Qoder footer）。
 */
function ComposerFooter() {
  const { workspace, primaryPath } = useActiveWorkspace()
  const [probeState, updateProbe] = useState<ProbeR | null>(null)
  const [branchesState, updateBranches] = useState<string[]>([])
  /** 没有工作区时一律按「无仓库」渲染：不在 effect 里同步清 state */
  const probe = primaryPath ? probeState : null
  const branches = primaryPath ? branchesState : []

  useEffect(
    function () {
      if (!primaryPath) return
      let cancelled = false
      void invoke<ProbeR>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path: primaryPath } })
        .then(function (result) {
          if (cancelled) return
          updateProbe(result)
          if (!result.isRepo) {
            updateBranches([])
            return
          }
          return invoke<BranchesR>(CHANNELS.WORKSPACE_GIT.BRANCHES, {
            params: { path: primaryPath }
          }).then(function (listed) {
            if (!cancelled) updateBranches(listed.branches)
          })
        })
        .catch(function () {
          if (!cancelled) {
            updateProbe(null)
            updateBranches([])
          }
        })
      return function () {
        cancelled = true
      }
    },
    [primaryPath]
  )

  async function handleCheckout(branch: string) {
    if (!primaryPath || branch === probe?.branch) return
    try {
      await invoke(CHANNELS.WORKSPACE_GIT.CHECKOUT, {
        params: { path: primaryPath, branch }
      })
      updateProbe({ isRepo: true, branch })
      toast.success(`已切换到 ${branch}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换分支失败')
    }
  }

  const showGit = Boolean(probe?.isRepo && probe.branch)

  return (
    <div className="text-muted-foreground flex min-h-7 w-full items-center gap-0 px-1 text-xs">
      <div className="flex min-w-0 flex-1 items-center justify-start gap-0">
        <span className="flex max-w-50 min-w-0 items-center gap-1.5 px-2.5 opacity-90">
          <Icon
            icon="lucide:folder"
            className="size-3 shrink-0"
          />
          <span
            className="truncate"
            title={primaryPath ?? '还没有选择工作区'}>
            {workspace?.title ?? '未选择工作区'}
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
                <span className="max-w-28 truncate">{probe?.branch}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 overflow-y-auto">
                {(branches.length > 0 ? branches : [probe?.branch].filter(Boolean)).map(
                  function (branch) {
                    if (!branch) return null
                    const isActive = branch === probe?.branch
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
    </div>
  )
}

export { ComposerFooter }
