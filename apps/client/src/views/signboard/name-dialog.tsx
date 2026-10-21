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
import { Label } from '@i-thinking/design/components/label'
import { useEffect, useState } from 'react'

interface NameDialogProps {
  open: boolean
  title: string
  description?: string
  label?: string
  placeholder?: string
  confirmLabel?: string
  initialValue?: string
  onClose: () => void
  onConfirm: (value: string) => Promise<void> | void
}

function NameDialog(props: NameDialogProps) {
  const [value, setValue] = useState(props.initialValue ?? '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(
    function () {
      if (!props.open) return
      setValue(props.initialValue ?? '')
      setSubmitting(false)
    },
    [props.open, props.initialValue]
  )

  async function submit() {
    const next = value.trim()
    if (!next || submitting) return
    setSubmitting(true)
    try {
      await props.onConfirm(next)
      props.onClose()
    } catch {
      /* 失败时保持打开，由调用方 toast */
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? (
            <DialogDescription>{props.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="space-y-2 py-1">
          <Label htmlFor="signboard-name-input">{props.label ?? '名称'}</Label>
          <Input
            id="signboard-name-input"
            autoFocus
            value={value}
            placeholder={props.placeholder}
            onChange={function (event) {
              setValue(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={props.onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!value.trim() || submitting}
            onClick={function () {
              void submit()
            }}>
            {props.confirmLabel ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { NameDialog }
