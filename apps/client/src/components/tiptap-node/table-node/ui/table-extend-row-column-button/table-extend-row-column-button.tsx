// @ts-nocheck
'use client'

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { type Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { FloatingPortal } from '@floating-ui/react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor.ts'
import { useTableHandleState } from '@/components/tiptap-node/table-node/hooks/use-table-handle-state.ts'

// --- Lib ---
import type { Orientation } from '@/components/tiptap-node/table-node/lib/tiptap-table-utils.ts'
import {
  EMPTY_CELL_HEIGHT,
  EMPTY_CELL_WIDTH,
  countEmptyRowsFromEnd,
  countEmptyColumnsFromEnd,
  marginRound,
  selectLastCell,
  runPreservingCursor
} from '@/components/tiptap-node/table-node/lib/tiptap-table-utils.ts'
import { cn } from '@/lib/tiptap-utils.ts'

// --- Icons ---
import { PlusSmallIcon } from '@/components/tiptap-icons/plus-small-icon.tsx'

// --- Internal ---
import { useTableExtendRowColumnButtonsPositioning } from '@/components/tiptap-node/table-node/ui/table-extend-row-column-button/use-table-extend-row-column.ts'
import './table-extend-row-column-button.scss'

interface TableExtendRowColumnButtonProps {
  editor?: Editor | null
  block: Node
  onMouseDown: () => void
  onMouseUp: () => void
  orientation: Orientation
  children?: React.ReactNode
}

/**
 * Simplified button component for extending/reducing table dimensions
 */
export const TableExtendRowColumnButton: React.FC<
  TableExtendRowColumnButtonProps
> = ({
  editor: providedEditor,
  onMouseDown,
  onMouseUp,
  orientation,
  children
}) => {
  const { editor } = useTiptapEditor(providedEditor)
  const state = useTableHandleState({ editor })
  const isRowOrientation = orientation === 'row'

  const movedRef = useRef(false)
  const [dragState, setDragState] = useState<{
    startPos: number
    originalHeight: number
    originalWidth: number
  } | null>(null)

  const startDrag = useCallback(
    (ev: React.MouseEvent) => {
      if (!state) return

      const dims = TableMap.get(state.block)
      movedRef.current = false

      setDragState({
        startPos: isRowOrientation ? ev.clientY : ev.clientX,
        originalHeight: dims.height,
        originalWidth: dims.width
      })

      onMouseDown()
      ev.preventDefault()
    },
    [state, isRowOrientation, onMouseDown]
  )

  const handleClick = useCallback(() => {
    if (movedRef.current || !editor || !state) return

    runPreservingCursor(editor, () => {
      selectLastCell(editor, state.block, state.blockPos, orientation)

      if (isRowOrientation) {
        editor.commands.addRowAfter()
      } else {
        editor.commands.addColumnAfter()
      }
    })
  }, [editor, isRowOrientation, orientation, state])

  const handleDragMove = useEffectEvent(function (ev: MouseEvent) {
    if (!dragState || !editor || !state) return

    movedRef.current = true

    const currentPos = isRowOrientation ? ev.clientY : ev.clientX
    const diff = currentPos - dragState.startPos
    const cellSize = isRowOrientation ? EMPTY_CELL_HEIGHT : EMPTY_CELL_WIDTH

    const currentDims = TableMap.get(state.block)
    const currentCount = isRowOrientation ? currentDims.height : currentDims.width
    const originalCount = isRowOrientation
      ? dragState.originalHeight
      : dragState.originalWidth

    const newCount = Math.max(1, originalCount + marginRound(diff / cellSize, 0.3))
    const delta = newCount - currentCount

    if (delta === 0) return

    if (delta > 0) {
      runPreservingCursor(editor, () => {
        selectLastCell(editor, state.block, state.blockPos, orientation)

        for (let i = 0; i < delta; i++) {
          if (isRowOrientation) {
            editor.commands.addRowAfter()
          } else {
            editor.commands.addColumnAfter()
          }
        }
      })
      return
    }

    runPreservingCursor(editor, () => {
      const absDelta = Math.abs(delta)

      const emptyCount = isRowOrientation
        ? countEmptyRowsFromEnd(editor, state.blockPos)
        : countEmptyColumnsFromEnd(editor, state.blockPos)

      const safeToRemove = Math.min(absDelta, emptyCount, currentCount - 1)

      selectLastCell(editor, state.block, state.blockPos, orientation)

      for (let i = 0; i < safeToRemove; i++) {
        if (isRowOrientation) {
          editor.commands.deleteRow()
        } else {
          editor.commands.deleteColumn()
        }
      }
    })
  })

  const handleDragUp = useEffectEvent(function () {
    setDragState(null)
    onMouseUp()
  })

  useEffect(() => {
    if (!dragState) return

    const handleMove = (ev: MouseEvent) => {
      handleDragMove(ev)
    }

    const handleUp = () => {
      handleDragUp()
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragState])

  if (!editor?.isEditable) return null

  return (
    <button
      className={cn(
        'tiptap-table-extend-row-column-button',
        isRowOrientation
          ? 'tiptap-table-row-end-add-remove'
          : 'tiptap-table-column-end-add-remove',
        dragState && 'editing'
      )}
      onClick={handleClick}
      onMouseDown={startDrag}
      type="button"
      aria-label={
        isRowOrientation ? t('EDITOR_ADD_REMOVE_ROWS') : t('EDITOR_ADD_REMOVE_COLS')
      }>
      {children ?? <PlusSmallIcon className="size-3.5 shrink-0" />}
    </button>
  )
}

export interface TableExtendRowColumnButtonsProps {
  editor?: Editor | null
  onMouseDown?: () => void
  onMouseUp?: () => void
}

export const TableExtendRowColumnButtons: React.FC<
  TableExtendRowColumnButtonsProps
> = ({ editor: providedEditor, onMouseDown, onMouseUp }) => {
  const { editor } = useTiptapEditor(providedEditor)
  const state = useTableHandleState({ editor })
  const { columnButton, rowButton } = useTableExtendRowColumnButtonsPositioning(
    state?.showAddOrRemoveColumnsButton ?? false,
    state?.showAddOrRemoveRowsButton ?? false,
    state?.referencePosTable ?? null
  )

  const handleDown = useCallback(() => {
    if (!editor) return
    editor.commands.freezeHandles()
    onMouseDown?.()
  }, [editor, onMouseDown])

  const handleUp = useCallback(() => {
    if (!editor) return
    editor.commands.unfreezeHandles()
    onMouseUp?.()
  }, [editor, onMouseUp])

  if (!state) return null

  const portalRoot = state.widgetContainer?.isConnected
    ? state.widgetContainer
    : undefined

  return (
    <FloatingPortal root={portalRoot}>
      <div
        ref={rowButton.ref}
        style={rowButton.style}>
        <TableExtendRowColumnButton
          editor={editor}
          orientation="row"
          block={state.block}
          onMouseDown={handleDown}
          onMouseUp={handleUp}
        />
      </div>

      <div
        ref={columnButton.ref}
        style={columnButton.style}>
        <TableExtendRowColumnButton
          editor={editor}
          orientation="column"
          block={state.block}
          onMouseDown={handleDown}
          onMouseUp={handleUp}
        />
      </div>
    </FloatingPortal>
  )
}

import { t } from '@/views/knowledge/locale.ts'