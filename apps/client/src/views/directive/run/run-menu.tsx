import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState } from 'react'

import type { Caps } from './run-caps'
import { ModeItem, StopGuardDialog } from './run-menu-parts.tsx'
import { RunGuardMenuItems } from './run-guard-menu-items.tsx'
import { useGuardRun } from './use-guard-run'

interface RunMenuProps {
  name: string
  caps: Caps
  onOnce: () => void | Promise<void>
  beforeGuard?: () => Promise<string | null>
  disabled?: boolean
  className?: string
  onceTitle?: string
}

function RunMenu(props: RunMenuProps) {
  const [isOpen, updateOpen] = useState(false)
  const guard = useGuardRun({ name: props.name, beforeGuard: props.beforeGuard })
  const isDisabled = props.disabled || !props.name

  return (
    <div className="inline-flex items-stretch">
      <Button
        type="button"
        size="sm"
        className={cn('cursor-pointer rounded-r-none px-3.5 shadow-xs', props.className)}
        title={props.onceTitle ?? '运行'}
        disabled={isDisabled || guard.isBusy}
        onClick={function () {
          void props.onOnce()
        }}>
        <Icon
          icon="mdi:play"
          className="size-4"
        />
        运行
      </Button>
      <DropdownMenu
        open={isOpen}
        onOpenChange={function (next) {
          updateOpen(next)
          if (next) void guard.refreshAlive()
        }}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              disabled={isDisabled || guard.isBusy}
              className="cursor-pointer rounded-l-none border-l border-primary-foreground/20 px-2.5 shadow-xs"
              aria-label="选择运行方式"
              title="选择运行方式"
            />
          }>
          <Icon
            icon="mdi:chevron-down"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-44">
          <ModeItem
            icon="mdi:play"
            label="单次运行"
            hint="跑完即止"
            onSelect={function () {
              void props.onOnce()
            }}
          />
          <DropdownMenuSeparator />
          <RunGuardMenuItems
            guard={guard}
            caps={props.caps}
            onStartGuard={function (kind) {
              void guard.startGuard(kind)
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <StopGuardDialog
        kind={guard.stopKind}
        name={props.name}
        isBusy={guard.isBusy}
        onClose={guard.closeStopDialog}
        onPick={function (force) {
          if (!guard.stopKind) return
          void guard.confirmStop(guard.stopKind, force)
        }}
      />
    </div>
  )
}

export { RunMenu }
export { WallRunBar } from './wall-run-bar.tsx'
