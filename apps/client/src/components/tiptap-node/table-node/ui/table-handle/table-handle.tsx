// @ts-nocheck
import { useCallback, useMemo, useState, type ComponentType } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'

import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'
import { useTableHandlePositioning } from '@/components/tiptap-node/table-node/ui/table-handle/use-table-handle-positioning.ts'
import { useTableHandleState } from '@/components/tiptap-node/table-node/hooks/use-table-handle-state.ts'
import { type Orientation } from '@/components/tiptap-node/table-node/lib/tiptap-table-utils.ts'

import { TableHandlePortal } from './table-handle-portal.tsx'

export interface TableHandleButtonProps {
  editor: Editor
  orientation: Orientation
  index?: number
  tablePos?: number
  tableNode?: Node
  onToggleOtherHandle?: (visible: boolean) => void
  onOpenChange?: (open: boolean) => void
}

export interface TableHandleRenderProps {
  editor: Editor
  state: ReturnType<typeof useTableHandleState>
  rowHandle: ReturnType<typeof useTableHandlePositioning>['rowHandle']
  colHandle: ReturnType<typeof useTableHandlePositioning>['colHandle']
  toggleRowVisibility: (visible: boolean) => void
  toggleColumnVisibility: (visible: boolean) => void
}

export interface TableHandleProps {
  editor?: Editor | null
  rowButton?: ComponentType<TableHandleButtonProps>
  columnButton?: ComponentType<TableHandleButtonProps>
}

function findShouldShowHandle(input: {
  menuOpen: null | 'row' | 'column'
  type: 'row' | 'column'
  isVisible: boolean
  isMounted: boolean
  index: number | undefined
}) {
  if (input.menuOpen === input.type) return true
  return input.isVisible && input.isMounted && typeof input.index === 'number'
}

function TableHandle(props: TableHandleProps) {
  const { editor } = useTiptapEditor(props.editor)
  const state = useTableHandleState({ editor })

  const [isRowVisible, setIsRowVisible] = useState(true)
  const [isColumnVisible, setIsColumnVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState<null | 'row' | 'column'>(null)

  const draggingState = useMemo(
    function () {
      if (!state?.draggingState) return undefined
      return {
        draggedCellOrientation: state.draggingState.draggedCellOrientation,
        mousePos: state.draggingState.mousePos,
        initialOffset: state.draggingState.initialOffset
      }
    },
    [state?.draggingState]
  )

  const { rowHandle, colHandle } = useTableHandlePositioning(
    state?.show || false,
    state?.referencePosCell || null,
    state?.referencePosTable || null,
    draggingState
  )

  const toggleRowVisibility = useCallback(function (visible: boolean) {
    setIsRowVisible(visible)
  }, [])

  const toggleColumnVisibility = useCallback(function (visible: boolean) {
    setIsColumnVisible(visible)
  }, [])

  const handleMenuOpenChange = useCallback(function (type: 'row' | 'column', open: boolean) {
    setMenuOpen(open ? type : null)
  }, [])

  if (!editor || !state) return null

  const shouldShowRow = findShouldShowHandle({
    menuOpen,
    type: 'row',
    isVisible: isRowVisible,
    isMounted: rowHandle.isMounted,
    index: state.rowIndex
  })
  const shouldShowColumn = findShouldShowHandle({
    menuOpen,
    type: 'column',
    isVisible: isColumnVisible,
    isMounted: colHandle.isMounted,
    index: state.colIndex
  })

  return (
    <TableHandlePortal
      editor={editor}
      widgetContainer={state.widgetContainer}
      rowHandle={rowHandle}
      colHandle={colHandle}
      rowIndex={state.rowIndex}
      colIndex={state.colIndex}
      blockPos={state.blockPos}
      block={state.block}
      shouldShowRow={shouldShowRow}
      shouldShowColumn={shouldShowColumn}
      RowButton={props.rowButton}
      ColumnButton={props.columnButton}
      onToggleRowVisibility={toggleRowVisibility}
      onToggleColumnVisibility={toggleColumnVisibility}
      onMenuOpenChange={handleMenuOpenChange}
    />
  )
}

TableHandle.displayName = 'TableHandle'

export { TableHandle }
