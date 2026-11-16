/**
 * 工作树管理：列出 / 新建 / 删除。
 *
 * 删除主工作树在 git 层就不允许，这里直接禁掉，避免用户点了才看到报错。
 */
import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { Switch } from '@cogito/design/components/switch'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { WorktreeEntry } from '@/lib/workspace-git'
import type { GitOpOutcome } from '@/features/git-operations/types.ts'

interface WorktreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  worktrees: readonly WorktreeEntry[]
  isLoading: boolean
  branches: readonly string[]
  onReload: () => void
  onAdd: (options: {
    targetPath: string
    branch?: string
    isNewBranch: boolean
  }) => Promise<GitOpOutcome>
  onRemove: (targetPath: string, isForce: boolean) => Promise<GitOpOutcome>
}

function findBaseName(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

function WorktreeDialog(props: WorktreeDialogProps) {
  const [targetPath, updateTargetPath] = useState('')
  const [branch, updateBranch] = useState('')
  const [isNewBranch, updateNewBranch] = useState(true)
  const [submitting, updateSubmitting] = useState(false)

  const { open, onReload } = props

  // 父级每次重渲染都会传新的箭头函数；effect 只跟 `open` 走，否则「打开时拉一次」
  // 会变成每次重渲染都再拉一次（拉完 setState 又重渲染 → 无限刷 IPC）
  const reloadRef = useRef(onReload)
  useEffect(
    function () {
      reloadRef.current = onReload
    },
    [onReload]
  )

  useEffect(
    function () {
      if (open) reloadRef.current()
    },
    [open]
  )

  async function submit() {
    const path = targetPath.trim()
    if (!path || submitting) return
    updateSubmitting(true)
    try {
      const outcome = await props.onAdd({
        targetPath: path,
        branch: branch.trim() || undefined,
        isNewBranch
      })
      if (outcome.ok) {
        toast.success(outcome.message)
        updateTargetPath('')
        updateBranch('')
        // 列表是父级传下来的快照，建完必须重拉，否则新工作树不会出现
        reloadRef.current()
      } else {
        toast.error(outcome.message)
      }
    } finally {
      updateSubmitting(false)
    }
  }

  async function remove(entry: WorktreeEntry, isForce: boolean) {
    const outcome = await props.onRemove(entry.path, isForce)
    if (outcome.ok) {
      toast.success(outcome.message)
      reloadRef.current()
    } else {
      toast.error(outcome.message)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(94vw,34rem)]">
        <DialogHeader>
          <DialogTitle>工作树</DialogTitle>
          <DialogDescription>
            同一个仓库的多个检出目录，可以同时在不同分支上工作。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="border-border/60 max-h-56 min-h-0 overflow-y-auto rounded-md border">
            {props.isLoading && props.worktrees.length === 0 ? (
              <p className="text-muted-foreground p-3 text-xs">读取中…</p>
            ) : props.worktrees.length === 0 ? (
              <p className="text-muted-foreground p-3 text-xs">没有工作树记录</p>
            ) : (
              <ul className="list-none divide-y divide-border/50">
                {props.worktrees.map(function (entry) {
                  return (
                    <li
                      key={entry.path}
                      className="flex items-center gap-2 px-2.5 py-2">
                      <Icon
                        icon="lucide:folder-tree"
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-xs font-medium"
                          title={entry.path}>
                          {findBaseName(entry.path)}
                        </p>
                        <p
                          className="text-muted-foreground truncate text-[11px]"
                          title={entry.path}>
                          {entry.branch ?? (entry.isDetached ? '游离 HEAD' : entry.head.slice(0, 7))}
                        </p>
                      </div>
                      {entry.isMain ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-[10px]">
                          主
                        </Badge>
                      ) : null}
                      {entry.isLocked ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]">
                          锁定
                        </Badge>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={entry.isMain}
                        className="text-destructive h-6 shrink-0 px-2 text-[11px]"
                        onClick={function () {
                          void remove(entry, false)
                        }}>
                        删除
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git-worktree-path">新工作树路径</Label>
              <Input
                id="git-worktree-path"
                value={targetPath}
                placeholder="D:/repo-feature（绝对路径）"
                onChange={function (event) {
                  updateTargetPath(event.target.value)
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git-worktree-branch">分支（可选）</Label>
              <Input
                id="git-worktree-branch"
                value={branch}
                placeholder={isNewBranch ? '留空则按目录名新建' : '已有分支名'}
                onChange={function (event) {
                  updateBranch(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void submit()
                }}
              />
              {props.branches.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {props.branches.slice(0, 8).map(function (name) {
                    return (
                      <Button
                        key={name}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={function () {
                          updateBranch(name)
                          updateNewBranch(false)
                        }}>
                        {name}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="git-worktree-new-branch">新建分支</Label>
              <Switch
                id="git-worktree-new-branch"
                checked={isNewBranch}
                onCheckedChange={updateNewBranch}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            关闭
          </Button>
          <Button
            type="button"
            disabled={submitting || targetPath.trim().length === 0}
            onClick={function () {
              void submit()
            }}>
            新建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { WorktreeDialog }
