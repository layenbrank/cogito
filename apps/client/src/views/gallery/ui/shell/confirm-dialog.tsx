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
import { Icon } from '@iconify/react'
import { useEffect, useState } from 'react'

/**
 * 确认 / 命名对话框：替代 `window.confirm` 与 `window.prompt`。
 *
 * 原生弹窗在 Tauri 里会阻塞 WebView，而且完全脱离主题（圆角、深浅色、字体都是系统的），
 * 也没法表达“这是危险操作、会影响 N 项”。图库里删除相簿、移入回收站、命名智能相簿都走这里。
 */
interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmText?: string
  isDestructive?: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={function () {
              props.onOpenChange(false)
            }}
          >
            取消
          </Button>
          <Button
            variant={props.isDestructive ? 'destructive' : 'default'}
            size="sm"
            onClick={function () {
              props.onConfirm()
              props.onOpenChange(false)
            }}
          >
            {props.isDestructive ? <Icon icon="lucide:trash-2" className="size-3.5" /> : null}
            {props.confirmText ?? '确定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PromptDialogProps {
  open: boolean
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  onSubmit: (value: string) => void
  onOpenChange: (open: boolean) => void
}

function PromptDialog(props: PromptDialogProps) {
  const [value, setValue] = useState(props.defaultValue ?? '')

  // 每次打开都回到默认值：上一次取消掉的内容不该泄漏到下一次
  useEffect(
    function () {
      if (props.open) setValue(props.defaultValue ?? '')
    },
    [props.open, props.defaultValue]
  )

  const trimmed = value.trim()

  function submit(): void {
    if (!trimmed) return
    props.onSubmit(trimmed)
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          placeholder={props.placeholder}
          aria-label={props.title}
          onChange={function (event) {
            setValue(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={function () {
              props.onOpenChange(false)
            }}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={!trimmed}
            onClick={submit}
          >
            {props.confirmText ?? '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog, PromptDialog }
export type { ConfirmDialogProps, PromptDialogProps }
