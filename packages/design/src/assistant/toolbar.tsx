import { NodeToolbar, Position } from '@xyflow/react'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

type ToolbarProps = ComponentProps<typeof NodeToolbar>

function Toolbar({ className, ...props }: ToolbarProps) {
  return (
    <NodeToolbar
      className={cn('bg-background flex items-center gap-1 rounded-sm border p-1.5', className)}
      data-slot="canvas-toolbar"
      position={Position.Bottom}
      {...props}
    />
  )
}

export { Toolbar }
export type { ToolbarProps }
