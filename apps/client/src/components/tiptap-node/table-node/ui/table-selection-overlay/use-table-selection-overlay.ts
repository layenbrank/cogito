// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { CellSelection, cellAround } from '@tiptap/pm/tables'
import { useFloating } from '@floating-ui/react'

import { useResizeOverlay } from '@/components/tiptap-node/table-node/ui/table-selection-overlay/use-resize-overlay.ts'
import {
  domCellAround,
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
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const anchorCellRef = useRef<number | null>(null)
  const activeHandleRef = useRef<ResizeHandle>(null)

  // 坐标来自 `getBoundingClientRect`（视口系），因此浮层也必须是 `fixed`：
  // 落回 absolute + 某个 DOM 容器会让两套坐标混用，滚动后一定错位。
  const { refs, floatingStyles, update } = useFloating({
    placement: 'top-start',
    strategy: 'fixed'
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

  /**
   * 选中框是「此刻视口坐标」的快照，浮层又是 `pointer-events: none` 的固定定位，
   * 滚动 / 窗口尺寸变化后不会自己跟着内容走 —— 必须重算，否则选中态停在原处。
   *
   * 用 capture 监听 `window` 的 `scroll`：滚动事件不冒泡，但会经过捕获阶段，
   * 这样编辑器内层滚动容器（不是 window 本身）也能覆盖到。
   */
  const isVisibleRef = useRef(isVisible)
  useEffect(
    function () {
      isVisibleRef.current = isVisible
    },
    [isVisible]
  )

  useEffect(
    function () {
      if (!editor) return
      let frame: number | null = null

      function schedule() {
        if (!isVisibleRef.current || frame !== null) return
        frame = window.requestAnimationFrame(function () {
          frame = null
          updateSelectionRect()
        })
      }

      window.addEventListener('scroll', schedule, true)
      window.addEventListener('resize', schedule)
      return function () {
        window.removeEventListener('scroll', schedule, true)
        window.removeEventListener('resize', schedule)
        if (frame !== null) window.cancelAnimationFrame(frame)
      }
    },
    [editor, updateSelectionRect]
  )

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
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    updateSelectionRect()

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, updateSelectionRect])

  return {
    isVisible,
    selectionRect,
    activeHandle,
    isMenuOpen,
    refs,
    floatingStyles,
    makeResizeHandler,
    handleMenuOpenChange
  }
}

export type { UseTableSelectionOverlayOptions }
export { useTableSelectionOverlay }
