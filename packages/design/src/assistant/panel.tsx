import { Panel as PanelPrimitive } from '@xyflow/react'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

type PanelProps = ComponentProps<typeof PanelPrimitive>

function Panel({ className, ...props }: PanelProps) {
  return (
    <PanelPrimitive
      className={cn('m-4 overflow-hidden rounded-md border bg-card p-1', className)}
      data-slot="canvas-panel"
      {...props}
    />
  )
}

export { Panel }
export type { PanelProps }
