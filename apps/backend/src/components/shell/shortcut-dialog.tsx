import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Kbd } from '@cogito/design/components/kbd'

import { NAV_ITEMS } from '@/constants/nav.ts'

interface ShortcutDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

function ShortcutDialog(props: ShortcutDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        props.onOpenChange(open)
      }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span>命令面板</span>
            <Kbd>⌘K</Kbd>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>明暗切换</span>
            <Kbd>D</Kbd>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>本表</span>
            <Kbd>?</Kbd>
          </li>
          {NAV_ITEMS.map(function (item) {
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3">
                <span>{item.label}</span>
                <span className="flex items-center gap-1">
                  <Kbd>G</Kbd>
                  <Kbd>{item.key.toUpperCase()}</Kbd>
                </span>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ShortcutDialog }
