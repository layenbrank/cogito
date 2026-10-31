import { Controls as ControlsPrimitive } from '@xyflow/react'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

type ControlsProps = ComponentProps<typeof ControlsPrimitive>

function Controls({ className, ...props }: ControlsProps) {
  return (
    <ControlsPrimitive
      className={cn(
        'gap-px overflow-hidden rounded-md border bg-card p-1 shadow-none!',
        '[&>button]:rounded-md [&>button]:border-none! [&>button]:bg-transparent! [&>button]:hover:bg-secondary!',
        className
      )}
      data-slot="canvas-controls"
      {...props}
    />
  )
}

export { Controls }
export type { ControlsProps }
