import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { Button } from '../components/button'
import { Separator } from '../components/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip'

type CheckpointProps = ComponentProps<'div'>

function Checkpoint({ className, children, ...props }: CheckpointProps) {
  return (
    <div
      data-slot="checkpoint"
      className={cn('text-muted-foreground flex items-center gap-0.5 overflow-hidden', className)}
      {...props}>
      {children}
      <Separator />
    </div>
  )
}

type CheckpointIconProps = ComponentProps<'span'>

function CheckpointIcon({ className, children, ...props }: CheckpointIconProps) {
  if (children) {
    return (
      <span
        className={cn('inline-flex shrink-0', className)}
        {...props}>
        {children}
      </span>
    )
  }
  return (
    <Icon
      icon="lucide:bookmark"
      className={cn('size-4 shrink-0', className)}
    />
  )
}

type CheckpointTriggerProps = ComponentProps<typeof Button> & {
  tooltip?: string
}

function CheckpointTrigger({
  children,
  variant = 'ghost',
  size = 'sm',
  tooltip,
  ...props
}: CheckpointTriggerProps) {
  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      data-slot="checkpoint-trigger"
      {...props}>
      {children}
    </Button>
  )

  if (!tooltip) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent
        align="start"
        side="bottom">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export { Checkpoint, CheckpointIcon, CheckpointTrigger }
export type { CheckpointIconProps, CheckpointProps, CheckpointTriggerProps }
