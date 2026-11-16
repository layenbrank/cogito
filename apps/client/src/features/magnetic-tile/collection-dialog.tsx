/**
 * 「新建集合」命名对话框：只要一个名字。
 *
 * 与 `views/signboard/name-dialog.tsx` 同形，但那边是看板域组件，这里不反向依赖视图。
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
import { useEffect, useState } from 'react'

interface CollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (title: string) => Promise<void>
}

function CollectionDialog(props: CollectionDialogProps) {
  const [title, updateTitle] = useState('')
  const [submitting, updateSubmitting] = useState(false)

  // 每次重新打开都从空开始：上一次没提交的残留名字会误导
  useEffect(
    function () {
      if (props.open) updateTitle('')
    },
    [props.open]
  )

  async function submit() {
    const next = title.trim()
    if (!next || submitting) return
    updateSubmitting(true)
    try {
      await props.onConfirm(next)
      props.onOpenChange(false)
    } finally {
      updateSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(92vw,24rem)]">
        <DialogHeader>
          <DialogTitle>新建集合</DialogTitle>
          <DialogDescription>
            集合是一块能装网址的文件夹磁贴；建好后右键网址选「加入集合」即可归拢。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="collection-title">名称</Label>
          <Input
            id="collection-title"
            autoFocus
            value={title}
            placeholder="例如：常用工具"
            onChange={function (event) {
              updateTitle(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void submit()
            }}
          />
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
            disabled={submitting || title.trim().length === 0}
            onClick={function () {
              void submit()
            }}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CollectionDialog }
