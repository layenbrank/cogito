// @ts-nocheck
import type { ComponentType } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import { FloatingPortal } from '@floating-ui/react'

import {
  colDragStart,
  rowDragStart
} from '@/components/tiptap-node/table-node/extensions/table-handle/table-handle-plugin.ts'
import { TableHandleMenu } from '@/components/tiptap-node/table-node/ui/table-handle-menu/table-handle-menu.tsx'
import type { TableHandleButtonProps } from './table-handle.tsx'

interface TableHandlePortalProps {
  editor: Editor
  widgetContainer: HTMLElement | null
  rowHandle: { ref: unknown; style: unknown; isMounted: boolean }
  colHandle: { ref: unknown; style: unknown; isMounted: boolean }
  rowIndex?: number
  colIndex?: number
  blockPos?: number
  block?: Node
  shouldShowRow: boolean
  shouldShowColumn: boolean
  RowButton?: ComponentType<TableHandleButtonProps>
  ColumnButton?: ComponentType<TableHandleButtonProps>
  onToggleRowVisibility: (visible: boolean) => void
  onToggleColumnVisibility: (visible: boolean) => void
  onMenuOpenChange: (type: 'row' | 'column', open: boolean) => void
}

function TableHandlePortal(props: TableHandlePortalProps) {
  const RowButton = props.RowButton || TableHandleMenu
  const ColumnButton = props.ColumnButton || TableHandleMenu

  return (
    <FloatingPortal root={props.widgetContainer}>
      {props.shouldShowRow ? (
        <div
          ref={props.rowHandle.ref}
          style={props.rowHandle.style}>
          <RowButton
            editor={props.editor}
            orientation="row"
            index={props.rowIndex}
            tablePos={props.blockPos}
            tableNode={props.block}
            onToggleOtherHandle={props.onToggleColumnVisibility}
            dragStart={rowDragStart}
            onOpenChange={function (open) {
              props.onMenuOpenChange('row', open)
            }}
          />
        </div>
      ) : null}

      {props.shouldShowColumn ? (
        <div
          ref={props.colHandle.ref}
          style={props.colHandle.style}>
          <ColumnButton
            editor={props.editor}
            orientation="column"
            index={props.colIndex}
            tablePos={props.blockPos}
            tableNode={props.block}
            onToggleOtherHandle={props.onToggleRowVisibility}
            dragStart={colDragStart}
            onOpenChange={function (open) {
              props.onMenuOpenChange('column', open)
            }}
          />
        </div>
      ) : null}
    </FloatingPortal>
  )
}

export { TableHandlePortal }
