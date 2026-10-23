import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Button } from '@cogito/design/components/button'
import { DropdownMenuItem } from '@cogito/design/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import type { JobKind } from '@/shared/ipc/specs/sidecar'

interface StopDialogProps {
  kind: JobKind | null
  name: string
  isBusy: boolean
  onClose: () => void
  onPick: (force: boolean) => void
}

function StopGuardDialog(props: StopDialogProps) {
  const label = props.kind === 'watch' ? 'watch' : 'cron'
  return (
    <AlertDialog
      open={props.kind !== null}
      onOpenChange={function (isOpen) {
        if (!isOpen) props.onClose()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>停止 {label} 守护？</AlertDialogTitle>
          <AlertDialogDescription>
            「{props.name}」当前有一次触发任务在跑。可等它跑完再停，或立刻连同任务一起终止。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogCancel disabled={props.isBusy}>取消</AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={props.isBusy}
            className="cursor-pointer"
            onClick={function (event) {
              event.preventDefault()
              event.stopPropagation()
              props.onPick(false)
            }}>
            等待本次结束
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={props.isBusy}
            className="cursor-pointer"
            onClick={function (event) {
              event.preventDefault()
              event.stopPropagation()
              props.onPick(true)
            }}>
            立即强制终止
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface ActionIconProps {
  icon: string
  label: string
  hint: string
  disabled?: boolean
  isActive?: boolean
  isBusy?: boolean
  onClick: () => void
}

function ActionIcon(props: ActionIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={props.disabled}
            aria-label={props.label}
            title={props.label}
            className={cn(
              'h-8 w-8 shrink-0 cursor-pointer border-border/80',
              props.isActive
                ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground'
                : 'text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground'
            )}
            onClick={props.onClick}>
            <Icon
              icon={props.icon}
              className={cn('size-4', props.isBusy && 'animate-pulse')}
            />
          </Button>
        }
      />
      <TooltipContent side="top">{props.hint}</TooltipContent>
    </Tooltip>
  )
}

interface ModeItemProps {
  icon: string
  label: string
  hint: string
  disabled?: boolean
  onSelect: () => void
}

function ModeItem(props: ModeItemProps) {
  return (
    <DropdownMenuItem
      disabled={props.disabled}
      className="cursor-pointer flex-col items-start gap-0.5 py-2"
      onClick={props.onSelect}>
      <span className="inline-flex items-center gap-2">
        <Icon
          icon={props.icon}
          className="size-4"
        />
        {props.label}
      </span>
      <span className="pl-6 text-xs text-muted-foreground">{props.hint}</span>
    </DropdownMenuItem>
  )
}

export { StopGuardDialog, ActionIcon, ModeItem }
