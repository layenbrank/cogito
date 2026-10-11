// @ts-nocheck
'use client'

import { useCallback, useMemo } from 'react'
import { useTableDuplicateRowColumn } from '@/components/tiptap-node/table-node/ui/table-duplicate-row-column-button/use-table-duplicate-row-column.ts'
import { useTableMoveRowColumn } from '@/components/tiptap-node/table-node/ui/table-move-row-column-button/use-table-move-row-column.ts'
import { useTableClearRowColumnContent } from '@/components/tiptap-node/table-node/ui/table-clear-row-column-content-button/use-table-clear-row-column-content.ts'
import { useTableHeaderRowColumn } from '@/components/tiptap-node/table-node/ui/table-header-row-column-button/use-table-header-row-column.ts'
import { useTableAddRowColumn } from '@/components/tiptap-node/table-node/ui/table-add-row-column-button/use-table-add-row-column.ts'
import { useTableDeleteRowColumn } from '@/components/tiptap-node/table-node/ui/table-delete-row-column-button/use-table-delete-row-column.ts'
import { useTableSortRowColumn } from '@/components/tiptap-node/table-node/ui/table-sort-row-column-button/use-table-sort-row-column.ts'
import { useTableHandleContext, type TableActionItemProps } from './table-handle-context.ts'

function useTableActionItems() {
  const { editor, index, orientation, tablePos } = useTableHandleContext()

  const deleteAction = useTableDeleteRowColumn({
    editor,
    index,
    orientation,
    tablePos
  })
  const duplicateAction = useTableDuplicateRowColumn({
    editor,
    index,
    orientation,
    tablePos
  })

  // Sort actions
  const sortAscAction = useTableSortRowColumn({
    editor,
    tablePos,
    index,
    orientation,
    direction: 'asc',
    hideWhenUnavailable: true
  })

  const sortDescAction = useTableSortRowColumn({
    editor,
    tablePos,
    index,
    orientation,
    direction: 'desc',
    hideWhenUnavailable: true
  })

  const clearContentAction = useTableClearRowColumnContent({
    editor,
    index,
    orientation,
    tablePos,
    resetAttrs: true,
    hideWhenUnavailable: true
  })

  const headerAction = useTableHeaderRowColumn({
    editor,
    index,
    orientation,
    tablePos,
    hideWhenUnavailable: true
  })

  const moveUpAction = useTableMoveRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'row',
    direction: 'up',
    hideWhenUnavailable: true
  })

  const moveDownAction = useTableMoveRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'row',
    direction: 'down',
    hideWhenUnavailable: true
  })

  const moveLeftAction = useTableMoveRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'column',
    direction: 'left',
    hideWhenUnavailable: true
  })

  const moveRightAction = useTableMoveRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'column',
    direction: 'right',
    hideWhenUnavailable: true
  })

  const addAbove = useTableAddRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'row',
    side: 'above',
    hideWhenUnavailable: true
  })

  const addBelow = useTableAddRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'row',
    side: 'below',
    hideWhenUnavailable: true
  })

  const addLeft = useTableAddRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'column',
    side: 'left',
    hideWhenUnavailable: true
  })

  const addRight = useTableAddRowColumn({
    editor,
    index,
    tablePos,
    orientation: 'column',
    side: 'right',
    hideWhenUnavailable: true
  })

  const moveActions = useMemo(
    () => ({
      moveUp: moveUpAction,
      moveDown: moveDownAction,
      moveLeft: moveLeftAction,
      moveRight: moveRightAction
    }),
    [moveUpAction, moveDownAction, moveLeftAction, moveRightAction]
  )

  const addActions = useMemo(
    () => ({
      addAbove,
      addBelow,
      addLeft,
      addRight
    }),
    [addAbove, addBelow, addLeft, addRight]
  )

  const sortActions = useMemo(
    () => ({
      sortAsc: sortAscAction,
      sortDesc: sortDescAction
    }),
    [sortAscAction, sortDescAction]
  )

  const getSortItems = useCallback(() => {
    const items: TableActionItemProps[] = []

    if (sortActions.sortAsc.isVisible) {
      items.push({
        icon: sortActions.sortAsc.Icon,
        label: sortActions.sortAsc.label,
        disabled: !sortActions.sortAsc.canSortRowColumn,
        onClick: sortActions.sortAsc.handleSort
      })
    }

    if (sortActions.sortDesc.isVisible) {
      items.push({
        icon: sortActions.sortDesc.Icon,
        label: sortActions.sortDesc.label,
        disabled: !sortActions.sortDesc.canSortRowColumn,
        onClick: sortActions.sortDesc.handleSort
      })
    }

    return items
  }, [sortActions])

  const getActionItems = useCallback(() => {
    const items: TableActionItemProps[] = []

    if (orientation === 'row') {
      if (addActions.addAbove.isVisible) {
        items.push({
          icon: addActions.addAbove.Icon,
          label: addActions.addAbove.label,
          disabled: !addActions.addAbove.canAddRowColumn,
          onClick: addActions.addAbove.handleAdd
        })
      }
      if (addActions.addBelow.isVisible) {
        items.push({
          icon: addActions.addBelow.Icon,
          label: addActions.addBelow.label,
          disabled: !addActions.addBelow.canAddRowColumn,
          onClick: addActions.addBelow.handleAdd
        })
      }
    } else {
      if (addActions.addLeft.isVisible) {
        items.push({
          icon: addActions.addLeft.Icon,
          label: addActions.addLeft.label,
          disabled: !addActions.addLeft.canAddRowColumn,
          onClick: addActions.addLeft.handleAdd
        })
      }
      if (addActions.addRight.isVisible) {
        items.push({
          icon: addActions.addRight.Icon,
          label: addActions.addRight.label,
          disabled: !addActions.addRight.canAddRowColumn,
          onClick: addActions.addRight.handleAdd
        })
      }
    }

    return items
  }, [orientation, addActions])

  const getMoveItems = useCallback(() => {
    const items: TableActionItemProps[] = []

    if (orientation === 'row') {
      if (moveActions.moveUp.isVisible) {
        items.push({
          icon: moveActions.moveUp.Icon,
          label: moveActions.moveUp.label,
          disabled: !moveActions.moveUp.canMoveRowColumn,
          onClick: moveActions.moveUp.handleMove
        })
      }
      if (moveActions.moveDown.isVisible) {
        items.push({
          icon: moveActions.moveDown.Icon,
          label: moveActions.moveDown.label,
          disabled: !moveActions.moveDown.canMoveRowColumn,
          onClick: moveActions.moveDown.handleMove
        })
      }
    } else {
      if (moveActions.moveLeft.isVisible) {
        items.push({
          icon: moveActions.moveLeft.Icon,
          label: moveActions.moveLeft.label,
          disabled: !moveActions.moveLeft.canMoveRowColumn,
          onClick: moveActions.moveLeft.handleMove
        })
      }
      if (moveActions.moveRight.isVisible) {
        items.push({
          icon: moveActions.moveRight.Icon,
          label: moveActions.moveRight.label,
          disabled: !moveActions.moveRight.canMoveRowColumn,
          onClick: moveActions.moveRight.handleMove
        })
      }
    }

    return items
  }, [orientation, moveActions])

  return {
    deleteAction,
    duplicateAction,
    clearContentAction,
    headerAction,
    addItems: getActionItems(),
    moveItems: getMoveItems(),
    sortItems: getSortItems()
  }
}

export { useTableActionItems }
