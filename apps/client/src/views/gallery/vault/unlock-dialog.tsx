import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import { Input } from '@i-thinking/design/components/input'
import { useState } from 'react'

import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/views/gallery/constraints'

interface UnlockDialogProps {
  open: boolean
  hasPin: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (pin: string) => Promise<{ ok: true } | { ok: false; reason: string }>
}

function UnlockDialog(props: UnlockDialogProps) {
  const [pin, onPin] = useState('')
  const [error, onError] = useState('')
  const [pending, onPending] = useState(false)

  async function handleSubmit() {
    onPending(true)
    onError('')
    try {
      const result = await props.onSubmit(pin)
      if (!result.ok) {
        onError(result.reason)
        return
      }
      onPin('')
      props.onOpenChange(false)
    } finally {
      onPending(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) {
          onPin('')
          onError('')
        }
        props.onOpenChange(open)
      }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon="lucide:lock" className="size-4" />
            {props.hasPin ? '解锁已隐藏' : '设置隐藏 PIN'}
          </DialogTitle>
          <DialogDescription>
            {props.hasPin
              ? '输入 PIN 以查看已隐藏的照片与视频。关闭窗口后需重新解锁。'
              : `首次使用请设置 ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} 位数字 PIN。`}
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_MAX_LENGTH}
          placeholder="PIN"
          value={pin}
          onChange={function (event) {
            onPin(event.target.value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH))
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') void handleSubmit()
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            取消
          </Button>
          <Button
            type="button"
            disabled={pending || pin.length < PIN_MIN_LENGTH}
            onClick={function () {
              void handleSubmit()
            }}>
            {props.hasPin ? '解锁' : '设置并进入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { UnlockDialog }
export type { UnlockDialogProps }
