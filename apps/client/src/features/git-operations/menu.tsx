/**
 * Git 更多操作菜单：储藏（新建 / 弹出 / 应用 / 删除）、变基（开始 / 继续 / 中止）、
 * 以及可选的「工作树」入口。
 *
 * 纯 props 驱动 —— code 窗与 agent 审阅面板各自接自己的数据源，UI 只有这一份。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useState } from 'react'
import { toast } from 'sonner'

import type { StashEntry } from '@/lib/workspace-git'
import { RebaseDialog } from '@/features/git-operations/rebase-dialog.tsx'
import { StashDialog } from '@/features/git-operations/stash-dialog.tsx'
import type { GitOpHandlers, GitOpOutcome } from '@/features/git-operations/types.ts'

/** 储藏列表最多列多少条（再多去终端更合适） */
const STASH_LIMIT = 10

interface GitOperationsMenuProps extends GitOpHandlers {
  stashes: readonly StashEntry[]
  /** 进行中的多步操作；rebase 时才出现「继续 / 中止」 */
  operation: string | null
  branch: string
  branches: readonly string[]
  isBusy?: boolean
  /** 工作树面板入口；不传则不渲染该项 */
  onOpenWorktrees?: () => void
}

function report(outcome: GitOpOutcome) {
  if (outcome.ok) toast.success(outcome.message)
  else toast.error(outcome.message)
}

function GitOperationsMenu(props: GitOperationsMenuProps) {
  const [isStashOpen, setStashOpen] = useState(false)
  const [isRebaseOpen, setRebaseOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="更多 Git 操作"
              title="更多 Git 操作"
              className="text-muted-foreground size-7">
              <Icon
                icon="lucide:ellipsis"
                className="size-4"
              />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>储藏</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={function () {
                setStashOpen(true)
              }}>
              <Icon
                icon="lucide:archive"
                className="text-muted-foreground"
              />
              储藏更改…
            </DropdownMenuItem>
            {props.stashes.length === 0 ? (
              <DropdownMenuItem disabled>
                <Icon
                  icon="lucide:archive-x"
                  className="text-muted-foreground"
                />
                没有储藏
              </DropdownMenuItem>
            ) : (
              props.stashes.slice(0, STASH_LIMIT).map(function (stash) {
                return (
                  <DropdownMenuSub key={stash.selector}>
                    <DropdownMenuSubTrigger>
                      <span className="min-w-0 truncate">
                        {stash.message || stash.selector}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={function () {
                          void props.onStashApply(stash.index, true).then(report)
                        }}>
                        弹出（应用并删除）
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={function () {
                          void props.onStashApply(stash.index, false).then(report)
                        }}>
                        应用（保留储藏）
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={function () {
                          void props.onStashDrop(stash.index).then(report)
                        }}>
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )
              })
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel>变基</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={Boolean(props.operation)}
              onClick={function () {
                setRebaseOpen(true)
              }}>
              <Icon
                icon="lucide:git-fork"
                className="text-muted-foreground"
              />
              变基到…
            </DropdownMenuItem>
            {props.operation === 'rebase' ? (
              <>
                <DropdownMenuItem
                  disabled={props.isBusy}
                  onClick={function () {
                    void props.onRebaseContinue().then(report)
                  }}>
                  <Icon
                    icon="lucide:play"
                    className="text-muted-foreground"
                  />
                  继续变基
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={props.isBusy}
                  onClick={function () {
                    void props.onRebaseAbort().then(report)
                  }}>
                  <Icon icon="lucide:x" />
                  中止变基
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>

          {props.onOpenWorktrees ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={props.onOpenWorktrees}>
                <Icon
                  icon="lucide:folder-tree"
                  className="text-muted-foreground"
                />
                工作树…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <StashDialog
        open={isStashOpen}
        onOpenChange={setStashOpen}
        onConfirm={async function (options) {
          report(await props.onStashPush(options))
        }}
      />
      <RebaseDialog
        open={isRebaseOpen}
        onOpenChange={setRebaseOpen}
        branch={props.branch}
        branches={props.branches}
        onConfirm={async function (upstream) {
          report(await props.onRebase(upstream))
        }}
      />
    </>
  )
}

export { GitOperationsMenu }
export type { GitOperationsMenuProps }
