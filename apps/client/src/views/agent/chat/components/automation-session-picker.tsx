/**
 * 「执行前选择对话」的对话框（页面级，挂在对话视图根上）。
 *
 * 只看 `useAutomationSessionPicker.request`：出现就开，选完 / 关掉都回给 runner。
 * 关掉 = 新建对话，和超时同一条兜底路径。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { clsx } from 'clsx'

import { useAutomationSessionPicker } from '@/features/automation/session-picker'

function AutomationSessionPicker() {
  const request = useAutomationSessionPicker(function (state) {
    return state.request
  })
  const settle = useAutomationSessionPicker(function (state) {
    return state.settle
  })

  return (
    <Dialog
      open={request !== null}
      onOpenChange={function (open) {
        if (!open) settle(null)
      }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>把这次执行写进哪个对话？</DialogTitle>
          <DialogDescription>
            {request
              ? `「${request.taskName}」即将开始。选一个已有对话接着聊，或新建一个（不选也按新建处理）。`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto py-1">
          {request && request.sessions.length > 0 ? (
            request.sessions.map(function (session) {
              return (
                <button
                  key={session.id}
                  type="button"
                  className={clsx(
                    'hover:bg-muted/60 focus-visible:ring-ring/40 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm outline-none transition-colors focus-visible:ring-2'
                  )}
                  onClick={function () {
                    settle(session.id)
                  }}>
                  <Icon
                    icon="lucide:message-square"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {session.workspaceTitle ?? '未分组'}
                  </span>
                </button>
              )
            })
          ) : (
            <p className="text-muted-foreground px-1 py-2 text-xs">
              还没有可选的对话，这次会新建一个。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={function () {
              settle(null)
            }}>
            新建对话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AutomationSessionPicker }
