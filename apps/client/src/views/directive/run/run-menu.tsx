import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

import type { JobKind } from '@/shared/ipc/specs/sidecar'

import { findDirectiveCaps, type Caps } from './run-caps'
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

interface WallRunBarProps {
  name: string
  caps: Caps
  onOnce: () => void
  disabled?: boolean
}

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
          {guard.alive.cron ? (
            <ModeItem
              icon={guard.isCronStopping ? 'mdi:timer-sand' : 'mdi:stop'}
              label={guard.isCronStopping ? '正在停止 cron' : '停止 cron'}
              hint={
                guard.isCronStopping
                  ? '已请求停止，等待本次结束'
                  : guard.isCronRunning
                    ? '当前有任务在跑'
                    : '结束定时守护'
              }
              onSelect={function () {
                guard.requestStop('cron')
              }}
            />
          ) : (
            <ModeItem
              icon="mdi:clock-outline"
              label="以 cron 守护"
              hint={props.caps.hasCron ? '按表达式定时触发' : '指令未声明 cron 触发器'}
              disabled={!props.caps.hasCron || guard.isBusy}
              onSelect={function () {
                void guard.startGuard('cron')
              }}
            />
          )}
          {guard.alive.watch ? (
            <ModeItem
              icon={guard.isWatchStopping ? 'mdi:timer-sand' : 'mdi:stop'}
              label={guard.isWatchStopping ? '正在停止 watch' : '停止 watch'}
              hint={
                guard.isWatchStopping
                  ? '已请求停止，等待本次结束'
                  : guard.isWatchRunning
                    ? '当前有任务在跑'
                    : '结束文件监听'
              }
              onSelect={function () {
                guard.requestStop('watch')
              }}
            />
          ) : (
            <ModeItem
              icon="mdi:eye-outline"
              label="以 watch 守护"
              hint={props.caps.hasWatch ? '文件变更时触发' : '指令未声明 watch 触发器'}
              disabled={!props.caps.hasWatch || guard.isBusy}
              onSelect={function () {
                void guard.startGuard('watch')
              }}
            />
          )}
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

function WallRunBar(props: WallRunBarProps) {
  const [caps, updateCaps] = useState(props.caps)
  const guard = useGuardRun({ name: props.name })
  const { refreshAlive } = guard

  const [givenCaps, updateGivenCaps] = useState({
    hasCron: props.caps.hasCron,
    hasWatch: props.caps.hasWatch
  })
  if (givenCaps.hasCron !== props.caps.hasCron || givenCaps.hasWatch !== props.caps.hasWatch) {
    updateGivenCaps({ hasCron: props.caps.hasCron, hasWatch: props.caps.hasWatch })
    updateCaps(props.caps)
  }

  useEffect(
    function () {
      if (!props.name) return
      let cancelled = false

      async function sync() {
        if (props.caps.hasCron && props.caps.hasWatch) {
          const refined = await findDirectiveCaps(props.name)
          if (cancelled) return
          updateCaps(refined)
        }
        if (cancelled) return
        await refreshAlive()
      }

      if (props.caps.hasCron || props.caps.hasWatch) void sync()
      return function () {
        cancelled = true
      }
    },
    [props.name, props.caps.hasCron, props.caps.hasWatch, refreshAlive]
  )

  function onGuardClick(kind: JobKind) {
    const isAliveGuard = kind === 'cron' ? guard.alive.cron : guard.alive.watch
    if (isAliveGuard) {
      guard.requestStop(kind)
      return
    }
    void guard.startGuard(kind)
  }

  const isDisabled = props.disabled || !props.name || guard.isBusy

  return (
    <div
      className="relative z-10 flex shrink-0 items-center gap-1"
      onClick={haltBubble}
      onPointerDown={haltBubble}>
      <ActionIcon
        icon="mdi:play"
        label={`运行 ${props.name}`}
        hint="单次运行"
        disabled={isDisabled}
        onClick={props.onOnce}
      />
      {caps.hasCron ? (
        <ActionIcon
          icon={
            guard.isCronStopping
              ? 'mdi:timer-sand'
              : guard.alive.cron
                ? 'mdi:stop'
                : 'mdi:clock-outline'
          }
          label={
            guard.isCronStopping
              ? `正在停止 cron · ${props.name}`
              : guard.alive.cron
                ? `停止 cron · ${props.name}`
                : `以 cron 守护 · ${props.name}`
          }
          hint={
            guard.isCronStopping
              ? '已请求停止，等待本次结束'
              : guard.alive.cron
                ? '守护中，点击停止'
                : '定时触发'
          }
          isActive={guard.alive.cron || guard.isCronRunning}
          isBusy={guard.isCronRunning || guard.isCronStopping}
          disabled={isDisabled}
          onClick={function () {
            onGuardClick('cron')
          }}
        />
      ) : null}
      {caps.hasWatch ? (
        <ActionIcon
          icon={
            guard.isWatchStopping
              ? 'mdi:timer-sand'
              : guard.alive.watch
                ? 'mdi:stop'
                : 'mdi:eye-outline'
          }
          label={
            guard.isWatchStopping
              ? `正在停止 watch · ${props.name}`
              : guard.alive.watch
                ? `停止 watch · ${props.name}`
                : `以 watch 守护 · ${props.name}`
          }
          hint={
            guard.isWatchStopping
              ? '已请求停止，等待本次结束'
              : guard.alive.watch
                ? '监听中，点击停止'
                : '文件变更触发'
          }
          isActive={guard.alive.watch || guard.isWatchRunning}
          isBusy={guard.isWatchRunning || guard.isWatchStopping}
          disabled={isDisabled}
          onClick={function () {
            onGuardClick('watch')
          }}
        />
      ) : null}
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
      <span className="pl-6 text-[11px] text-muted-foreground">{props.hint}</span>
    </DropdownMenuItem>
  )
}

function haltBubble(event: { stopPropagation(): void }) {
  event.stopPropagation()
}

export { RunMenu, WallRunBar }
