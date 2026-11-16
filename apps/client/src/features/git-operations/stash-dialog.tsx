/**
 * 「储藏更改」对话框：说明可选 + 是否带上未跟踪文件。
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

interface StashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: { message?: string; isIncludeUntracked: boolean }) => Promise<void>
}

function StashDialog(props: StashDialogProps) {
  const [message, updateMessage] = useState('')
  // 默认带上未跟踪文件：多数「先放一边」的场景里，新建但没 git add 的文件也算要一起收走的
  const [isIncludeUntracked, updateIncludeUntracked] = useState(true)
  const [submitting, updateSubmitting] = useState(false)

  async function submit() {
    if (submitting) return
    updateSubmitting(true)
    try {
      await props.onConfirm({
        message: message.trim() || undefined,
        isIncludeUntracked
      })
      updateMessage('')
      props.onOpenChange(false)
    } finally {
      updateSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(92vw,26rem)]">
        <DialogHeader>
          <DialogTitle>储藏更改</DialogTitle>
          <DialogDescription>
            把当前工作区改动收进储藏，工作区恢复干净；之后可以再弹出或应用。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-stash-message">说明（可选）</Label>
            <Input
              id="git-stash-message"
              autoFocus
              value={message}
              placeholder="例如：改到一半的登录页"
              onChange={function (event) {
                updateMessage(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void submit()
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="git-stash-untracked">包含未跟踪文件</Label>
              <p className="text-muted-foreground text-xs">对应 `git stash -u`，会把新建但未 add 的文件一起收走。</p>
            </div>
            <Switch
              id="git-stash-untracked"
              checked={isIncludeUntracked}
              onCheckedChange={updateIncludeUntracked}
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
            储藏
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { StashDialog }
