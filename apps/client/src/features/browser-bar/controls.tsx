import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from 'cn'

import { WINDOW_CONTROLS, type CaptionState, type WindowControl } from '@/components/caption/caption'

interface ControlButtonProps {
  control: WindowControl
  state: CaptionState
  onRefresh: () => void
}

function ControlButton(props: ControlButtonProps) {
  const label = props.control.findLabel(props.state)
  const isEnabled = props.control.isEnabled(props.state)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!isEnabled}
            data-region="false"
            data-window-control={props.control.key}
            aria-label={label}
            aria-disabled={!isEnabled}
            className={cn(
              'size-10 min-w-10 shrink-0 rounded-lg border-0',
              'text-muted-foreground hover:bg-foreground/8 hover:text-foreground',
              props.control.isDestructive &&
                isEnabled &&
                'hover:bg-destructive hover:text-white active:bg-destructive/90',
              !isEnabled && 'pointer-events-none opacity-40'
            )}
            onClick={function () {
              if (!isEnabled) return
              void props.control.run(getCurrentWindow(), props.state).then(function () {
                if (props.control.needsRefresh) props.onRefresh()
              })
            }}
          />
        }>
        <Icon
          icon={props.control.findIcon(props.state)}
          aria-hidden
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

interface WindowControlsProps {
  state: CaptionState
  onRefresh: () => void
  /** 不传则只渲染默认键（最小化 / 最大化 / 关闭） */
  controls?: readonly WindowControl[]
}

function WindowControls(props: WindowControlsProps) {
  const controls =
    props.controls ??
    WINDOW_CONTROLS.filter(function (control) {
      return control.isDefault !== false
    })
  if (controls.length === 0) return null

  return (
    <div className="flex shrink-0 items-center self-center pr-1.5">
      {controls.map(function (control) {
        return (
          <ControlButton
            key={control.key}
            control={control}
            state={props.state}
            onRefresh={props.onRefresh}
          />
        )
      })}
    </div>
  )
}

export { WindowControls }
