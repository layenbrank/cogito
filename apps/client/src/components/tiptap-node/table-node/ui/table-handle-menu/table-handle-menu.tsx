// @ts-nocheck
'use client'

import { useCallback, useMemo } from 'react'

import { useTiptapEditor } from '@/hooks/use-tiptap-editor'
import { cn } from '@/lib/tiptap-utils'
import { MoreVerticalIcon } from '@/components/tiptap-icons/more-vertical-icon'
import { Menu, MenuButton } from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import { dragEnd } from '@/components/tiptap-node/table-node/extensions/table-handle/table-handle-plugin.ts'
import {
  TableHandleContext,
  useTableHandleContext,
  type TableHandleContextValue,
  type TableHandleMenuProps
} from './table-handle-context.ts'
import { ARIA_LABELS, useTableHandleMenu } from './use-table-handle-menu.ts'
import { TableActionMenu } from './table-action-group.tsx'

import './table-handle-menu.scss'

function TableHandleMenuContent({
  onToggleOtherHandle,
  onOpenChange,
  dragStart
}: Pick<TableHandleMenuProps, 'onToggleOtherHandle' | 'onOpenChange' | 'dragStart'>) {
  const { orientation } = useTableHandleContext()
  const {
    isMenuOpen,
    isDragging,
    setIsDragging,
    menuPlacement,
    handleMenuToggle
  } = useTableHandleMenu(onToggleOtherHandle, onOpenChange)

  const ariaLabel = ARIA_LABELS[orientation]

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      setIsDragging(true)
      dragStart?.(e)
    },
    [dragStart, setIsDragging]
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    dragEnd()
  }, [setIsDragging])

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={handleMenuToggle}
      placement={menuPlacement}
      trigger={
        <MenuButton
          className={cn(
            'tiptap-table-handle-menu',
            isMenuOpen && 'menu-opened',
            isDragging && 'is-dragging',
            orientation
          )}
          draggable={true}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}>
          <MoreVerticalIcon className="size-3.5 shrink-0" />
        </MenuButton>
      }>
      <TableActionMenu />
    </Menu>
  )
}

export const TableHandleMenu = ({
  editor: providedEditor,
  orientation,
  index,
  tableNode,
  tablePos,
  onToggleOtherHandle,
  onOpenChange,
  dragStart
}: TableHandleMenuProps) => {
  const { editor } = useTiptapEditor(providedEditor)

  const contextValue = useMemo<TableHandleContextValue>(
    () => ({
      editor,
      orientation,
      index,
      tableNode,
      tablePos
    }),
    [editor, orientation, index, tableNode, tablePos]
  )

  return (
    <TableHandleContext.Provider value={contextValue}>
      <TableHandleMenuContent
        onToggleOtherHandle={onToggleOtherHandle}
        onOpenChange={onOpenChange}
        dragStart={dragStart}
      />
    </TableHandleContext.Provider>
  )
}

export { TableActionMenu }
export type { TableHandleMenuProps }
