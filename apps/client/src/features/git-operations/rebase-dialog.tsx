/**
 * 「变基到…」对话框：目标分支 / 提交 + 是否自动储藏未提交改动。
 */
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
import { useState } from 'react'

interface RebaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前分支，仅用于占位提示 */
  branch: string
  /** 本地分支，做快速填充 */
  branches: readonly string[]
  onConfirm: (upstream: string | null) => Promise<void>
}

function RebaseDialog(props: RebaseDialogProps) {
  const [upstream, updateUpstream] = useState('')
  // 默认 --autostash：否则脏工作区直接 rebase 会被 git 拒绝，用户还要自己去储藏
  const [isAutostash, updateAutostash] = useState(true)
  const [submitting, updateSubmitting] = useState(false)

  async function submit() {
    if (submitting) return
    updateSubmitting(true)
    try {
      await props.onConfirm(upstream.trim() || null)
      props.onOpenChange(false)
    } finally {
      updateSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(92vw,28rem)]">
        <DialogHeader>
          <DialogTitle>变基</DialogTitle>
          <DialogDescription>
            {props.branch ? `把 ${props.branch} 上的提交搬到目标之上。` : '把当前分支的提交搬到目标之上。'}
            冲突时会出现「继续 / 中止」条。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-rebase-upstream">目标（留空 = 当前分支上游）</Label>
            <Input
              id="git-rebase-upstream"
              autoFocus
              value={upstream}
              placeholder="main / origin/main / 某个提交"
              onChange={function (event) {
                updateUpstream(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void submit()
              }}
            />
            {props.branches.length > 0 ? (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {props.branches.slice(0, 8).map(function (name) {
                  return (
                    <Button
                      key={name}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={function () {
                        updateUpstream(name)
                      }}>
                      {name}
                    </Button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="git-rebase-autostash">自动储藏未提交改动</Label>
              <p className="text-muted-foreground text-xs">对应 `--autostash`，变基完成后自动还原。</p>
            </div>
            <Switch
              id="git-rebase-autostash"
              checked={isAutostash}
              onCheckedChange={updateAutostash}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={function () {
              props.onOpenChange(false)
            }}>
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={function () {
              void submit()
            }}>
            开始变基
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { RebaseDialog, type RebaseDialogProps }
