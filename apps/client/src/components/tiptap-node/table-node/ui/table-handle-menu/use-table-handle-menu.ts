// @ts-nocheck
'use client'

import { useCallback, useMemo, useState } from 'react'
import { TableMap } from '@tiptap/pm/tables'
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'
import { isValidPosition } from '@/lib/tiptap-utils'
import type { Orientation } from '@/components/tiptap-node/table-node/lib/tiptap-table-utils'
import { selectCellsByCoords } from '@/components/tiptap-node/table-node/lib/tiptap-table-utils'
import { Menu } from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import { useTableHandleContext } from './table-handle-context.ts'

const MENU_PLACEMENT_MAP: Record<
  Orientation,
  React.ComponentProps<typeof Menu>['placement']
> = {
  row: 'top-start',
  column: 'bottom-start'
}

const ARIA_LABELS: Record<Orientation, string> = {
  row: 'Row actions',
  column: 'Column actions'
}

function useTableHandleMenu(
  onToggleOtherHandle?: (visible: boolean) => void,
  onOpenChange?: (open: boolean) => void
) {
  const { editor, orientation, index, tableNode, tablePos } =
    useTableHandleContext()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const menuPlacement = useMemo(
    () => MENU_PLACEMENT_MAP[orientation],
    [orientation]
  )

  const selectRowOrColumn = useCallback(() => {
    if (
      !editor ||
      !tableNode ||
      !isValidPosition(tablePos) ||
      !isValidPosition(index)
    )
      return

    try {
      const { width, height } = TableMap.get(tableNode)
      const start =
        orientation === 'row' ? { row: index, col: 0 } : { row: 0, col: index }
      const end =
        orientation === 'row'
          ? { row: index, col: width - 1 }
          : { row: height - 1, col: index }

      selectCellsByCoords(editor, tablePos, [start, end], {
        mode: 'dispatch',
        dispatch: editor.view.dispatch.bind(editor.view)
      })
    } catch (error) {
      console.warn('Failed to select row/column:', error)
    }
  }, [editor, tableNode, tablePos, orientation, index])

  const handleMenuToggle = useCallback(
    (isOpen: boolean) => {
      if (!editor) return

      setIsMenuOpen(isOpen)
      onOpenChange?.(isOpen)

      if (isOpen) {
        editor.commands.freezeHandles()
        selectRowOrColumn()
        onToggleOtherHandle?.(false)
      } else {
        editor.commands.unfreezeHandles()
        onToggleOtherHandle?.(true)
      }
    },
    [editor, onOpenChange, onToggleOtherHandle, selectRowOrColumn]
  )

  const resetMenu = useCallback(() => {
    if (!editor) return

    setIsMenuOpen(false)
    onOpenChange?.(false)
    editor.commands.unfreezeHandles()
    onToggleOtherHandle?.(true)
  }, [editor, onOpenChange, onToggleOtherHandle])

  return {
    isMenuOpen,
    isDragging,
    setIsDragging,
    menuPlacement,
    handleMenuToggle,
    resetMenu
  }
}

export { useTableHandleMenu, ARIA_LABELS, MENU_PLACEMENT_MAP }
