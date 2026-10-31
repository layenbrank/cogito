import type { ReactFlowProps } from '@xyflow/react'
import { Background, ReactFlow } from '@xyflow/react'
import type { ReactNode } from 'react'

import '@xyflow/react/dist/style.css'

type CanvasProps = ReactFlowProps & {
  children?: ReactNode
}

const DELETE_KEY_CODE = ['Backspace', 'Delete']

function Canvas({ children, ...props }: CanvasProps) {
  return (
    <ReactFlow
      data-slot="agent-canvas"
      deleteKeyCode={DELETE_KEY_CODE}
      fitView
      panOnDrag={false}
      panOnScroll
      selectionOnDrag
      zoomOnDoubleClick={false}
      {...props}>
      <Background bgColor="var(--sidebar)" />
      {children}
    </ReactFlow>
  )
}

export { Canvas }
export type { CanvasProps }
