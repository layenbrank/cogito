// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { CellSelection, cellAround } from '@tiptap/pm/tables'
import { useFloating } from '@floating-ui/react'

import { useResizeOverlay } from '@/components/tiptap-node/table-node/ui/table-selection-overlay/use-resize-overlay.ts'
import {
  domCellAround,
  findTable,
  rectEq
} from '@/components/tiptap-node/table-node/lib/tiptap-table-utils.ts'
import {
  makeVirtualReference,
  findAnchorCellForHandle,
  findCellAtCoordinates,
  findSelectionBoundingRect,
  findSingleCellBoundingRect,
  type ResizeHandle
} from './selection-geometry.ts'

interface UseTableSelectionOverlayOptions {
  editor: Editor | null
  showResizeHandles: boolean
  onMenuOpenChange?: (isOpen: boolean) => void
}

function useTableSelectionOverlay(options: UseTableSelectionOverlayOptions) {
  const { editor, showResizeHandles, onMenuOpenChange } = options
  const [isVisible, setIsVisible] = useState(true)
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null)
  const [tableDom, setTableDom] = useState<HTMLElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const anchorCellRef = useRef<number | null>(null)
  const activeHandleRef = useRef<ResizeHandle>(null)
  const containerRef = useRef<HTMLElement | null>(null)

  const { refs, floatingStyles, update } = useFloating({
    placement: 'top-start'
  })

  useEffect(() => {
    if (selectionRect) {
      const virtualReference = makeVirtualReference(selectionRect)
      refs.setPositionReference(virtualReference)
    }
  }, [selectionRect, refs])

  const updateSelectionRect = useCallback(() => {
    if (!editor) return

    const { selection } = editor.state

    if (selection instanceof CellSelection) {
      const rect = findSelectionBoundingRect(editor.view, selection)

      if (!rect) {
        setIsVisible(false)
        setSelectionRect((prev) => (prev ? null : prev))
        return
      }

      setSelectionRect((prev) => (rectEq(prev, rect) ? prev : rect))
      setIsVisible(true)
      return
    }

    const { $anchor } = selection
    const cell = cellAround($anchor)

    if (cell) {
      const rect = findSingleCellBoundingRect(editor.view, cell.pos)

      if (rect) {
        setSelectionRect((prev) => (rectEq(prev, rect) ? prev : rect))
        setIsVisible(true)
        return
      }
    }

    setIsVisible(false)
    setSelectionRect((prev) => (prev ? null : prev))
  }, [editor])

  useResizeOverlay(editor, updateSelectionRect)

  useEffect(() => {
    if (update && selectionRect) {
      update()
    }
  }, [update, selectionRect])

  const makeResizeHandler = useCallback(
    (handle: ResizeHandle) => (event: React.MouseEvent) => {
      if (!editor || !handle || !selectionRect || isMenuOpen || !showResizeHandles) return

      event.preventDefault()
      event.stopPropagation()

      const { selection } = editor.state
      let cellSelection: CellSelection | null = null

      if (selection instanceof CellSelection) {
        cellSelection = selection
      } else {
        const { $anchor } = selection
        const cell = cellAround($anchor)

        if (cell) {
          try {
            cellSelection = CellSelection.create(editor.state.doc, cell.pos, cell.pos)
          } catch (error) {
            console.warn('Could not create single cell selection for resize:', error)
            return
          }
        }
      }

      if (!cellSelection) return

      const anchorCell = findAnchorCellForHandle(
        editor.view,
        cellSelection,
        selectionRect,
        handle
      )
      if (!anchorCell) return

      setActiveHandle(handle)
      activeHandleRef.current = handle
      anchorCellRef.current = anchorCell.pos

      const handleMouseMove = (mouseEvent: MouseEvent) => {
        if (!editor || anchorCellRef.current === null) return

        const target = domCellAround(mouseEvent.target as Element)
        if (!target || target.type !== 'cell') return

        const targetCell = findCellAtCoordinates(
          editor.state,
          editor.view,
          mouseEvent.clientX,
          mouseEvent.clientY
        )
        if (!targetCell) return

        try {
          const newSelection = CellSelection.create(
            editor.state.doc,
            anchorCellRef.current,
            targetCell.pos
          )

          const transaction = editor.state.tr.setSelection(newSelection)
          editor.view.dispatch(transaction)
        } catch (error) {
          console.debug('Invalid cell selection during resize:', error)
        }
      }

      const handleMouseUp = () => {
        setActiveHandle(null)
        activeHandleRef.current = null
        anchorCellRef.current = null

        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [editor, selectionRect, isMenuOpen, showResizeHandles]
  )

  const updateTableDom = useCallback(() => {
    if (!editor) {
      setTableDom(null)
      return
    }

    const table = findTable(editor)
    if (!table) {
      setTableDom(null)
      return
    }

    setTableDom((prev) => {
      const currentDom = prev
      const newDom = editor.view.nodeDOM(table.pos) as HTMLElement | null
      return currentDom === newDom ? currentDom : newDom
    })
  }, [editor])

  const handleMenuOpenChange = useCallback(
    (isOpen: boolean) => {
      setIsMenuOpen(isOpen)
      onMenuOpenChange?.(isOpen)
    },
    [onMenuOpenChange]
  )

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      updateSelectionRect()
      updateTableDom()
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    updateSelectionRect()
    updateTableDom()

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, updateSelectionRect, updateTableDom])

  useEffect(() => {
    const c = tableDom?.querySelector(
      '.table-selection-overlay-container'
    ) as HTMLElement | null
    containerRef.current = c ?? null
  }, [tableDom])

  return {
    isVisible,
    selectionRect,
    activeHandle,
    isMenuOpen,
    refs,
    floatingStyles,
    containerRef,
    makeResizeHandler,
    handleMenuOpenChange
  }
}

export type { UseTableSelectionOverlayOptions }
export { useTableSelectionOverlay }
