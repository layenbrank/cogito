import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import {
  Context,
  ContextContent,
  ContextContentHeader,
  ContextTrigger
} from '@cogito/design/assistant/context'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import styles from './composer-footer.module.scss'
import {
  findGooseUsage,
  formatGooseUsage,
  subscribeGooseUsage,
  type GooseUsage
} from '@/features/agent/acp/goose-usage'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { bumpWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
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
 * 输入框下方：工作区 · 本机运行 · 分支（对齐 Qoder footer）。
 */
function ComposerFooter() {
  const { workspace, rootPath } = useActiveWorkspace()
  const [probeState, updateProbe] = useState<ProbeR | null>(null)
  const [branchesState, updateBranches] = useState<string[]>([])
  /** 没有工作区时一律按「无仓库」渲染：不在 effect 里同步清 state */
  const probe = rootPath ? probeState : null
  const branches = rootPath ? branchesState : []

  useEffect(
    function () {
      if (!rootPath) return
      let cancelled = false
      void invoke<ProbeR>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path: rootPath } })
        .then(function (result) {
          if (cancelled) return
          updateProbe(result)
          if (!result.isRepo) {
            updateBranches([])
            return
          }
          return invoke<BranchesR>(CHANNELS.WORKSPACE_GIT.BRANCHES, {
            params: { path: rootPath }
          }).then(function (listed) {
            if (!cancelled) updateBranches(listed.branches)
          })
        })
        .catch(function (error) {
          console.warn('[composer-footer] 探测 Git 失败:', error)
          if (!cancelled) {
            updateProbe(null)
            updateBranches([])
          }
        })
      return function () {
        cancelled = true
      }
    },
    [rootPath]
  )

  async function handleCheckout(branch: string) {
    if (!rootPath || branch === probe?.branch) return
    try {
      await invoke(CHANNELS.WORKSPACE_GIT.CHECKOUT, {
        params: { path: rootPath, branch }
      })
      updateProbe({ isRepo: true, branch })
      // 分支一换，磁盘内容就变了：让文件树 / 审阅 / 历史重拉
      bumpWorkspaceRevision()
      toast.success(`已切换到 ${branch}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换分支失败')
    }
  }

  function handleInsertBranch() {
    // WORKSPACE_GIT 尚无 create-branch IPC；代码 SCM 分支切换器同样只有 checkout
    toast.message('暂不支持在此新建分支', {
      description: '请在终端执行 git checkout -b <名称>'
    })
  }

  const showGit = Boolean(probe?.isRepo && probe.branch)
  const listedBranches =
    branches.length > 0 ? branches : probe?.branch ? [probe.branch] : []

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
            title={rootPath ?? '还没有选择工作区'}>
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
                side="top"
                sideOffset={8}
                className={styles.surface}>
                <div className={styles.list}>
                  {listedBranches.map(function (branch) {
                    const isActive = branch === probe?.branch
                    return (
                      <DropdownMenuItem
                        key={branch}
                        title={branch}
                        className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                        onClick={function () {
                          void handleCheckout(branch)
                        }}>
                        <Icon
                          icon="lucide:git-branch"
                          className={styles.branchIcon}
                        />
                        <span className={styles.name}>{branch}</span>
                        {isActive ? (
                          <Icon
                            icon="lucide:check"
                            className={styles.check}
                          />
                        ) : null}
                      </DropdownMenuItem>
                    )
                  })}
                </div>
                <div className={styles.footer}>
                  <DropdownMenuItem
                    className={styles.footerRow}
                    onClick={handleInsertBranch}>
                    <Icon
                      icon="lucide:plus"
                      className={styles.footerIcon}
                    />
                    新建分支
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      <UsageDisplay />
    </div>
  )
}

export { ComposerFooter }
