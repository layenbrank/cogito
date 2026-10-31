import type Konva from 'konva'
import { useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from 'react'

import {
  clampSelectionRect,
  type HandleType
} from '@/features/capture/components/selection-clamp'
import type { SelectionOverlayHandle } from '@/features/capture/components/selection-overlay.tsx'

interface Point {
  x: number
  y: number
}
interface Size {
  w: number
  h: number
}

function useSelectionOverlayHandlers(options: {
  ref: Ref<SelectionOverlayHandle>
  selection: (Point & Size) | null
  width: number
  height: number
  onSelectionChange: (selection: Point & Size) => void
  borderGroupRef: RefObject<Konva.Group | null>
}) {
  const dragHandleRef = useRef<HandleType | null>(null)
  const dragStartRef = useRef({ px: 0, py: 0, sx: 0, sy: 0, sw: 0, sh: 0 })
  const borderDragRef = useRef<{ startX: number; startY: number } | null>(null)
  const selectionRef = useRef(options.selection)

  useEffect(
    function () {
      selectionRef.current = options.selection
    },
    [options.selection]
  )

  function clampSelection(type: HandleType, px: number, py: number) {
    const next = clampSelectionRect({
      type,
      px,
      py,
      dragStart: dragStartRef.current,
      width: options.width,
      height: options.height
    })
    options.onSelectionChange(next)
  }

  useImperativeHandle(
    options.ref,
    function () {
      return {
        handleStageMouseMove(stagePos: { x: number; y: number }) {
          const type = dragHandleRef.current
          if (type) {
            clampSelection(type, stagePos.x, stagePos.y)
            return
          }
          const drag = borderDragRef.current
          const sel = selectionRef.current
          if (drag && options.borderGroupRef.current && sel) {
            const group = options.borderGroupRef.current
            const curX = group.x()
            const curY = group.y()
            const dx = stagePos.x - drag.startX
            const dy = stagePos.y - drag.startY
            const newX = Math.max(0, Math.min(curX + dx, options.width - sel.w))
            const newY = Math.max(0, Math.min(curY + dy, options.height - sel.h))
            group.position({ x: newX, y: newY })
            drag.startX = stagePos.x
            drag.startY = stagePos.y
          }
        },
        handleStageMouseUp() {
          dragHandleRef.current = null
          const drag = borderDragRef.current
          const sel = selectionRef.current
          if (drag && options.borderGroupRef.current && sel) {
            const finalX = options.borderGroupRef.current.x()
            const finalY = options.borderGroupRef.current.y()
            options.onSelectionChange({ x: finalX, y: finalY, w: sel.w, h: sel.h })
          }
          borderDragRef.current = null
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.width, options.height, options.onSelectionChange]
  )

  function onHandleDown(type: HandleType, e: Konva.KonvaEventObject<MouseEvent>, origin: Point & Size) {
    e.cancelBubble = true
    const stage = e.target.getStage()
    const pt = stage?.getPointerPosition()
    if (!pt) return
    dragHandleRef.current = type
    dragStartRef.current = {
      px: pt.x,
      py: pt.y,
      sx: origin.x,
      sy: origin.y,
      sw: origin.w,
      sh: origin.h
    }
  }

  function onBorderMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    e.cancelBubble = true
    const stage = e.target.getStage()
    const pt = stage?.getPointerPosition()
    if (!pt) return
    borderDragRef.current = {
      startX: pt.x,
      startY: pt.y
    }
  }

  return { dragHandleRef, onHandleDown, onBorderMouseDown }
}

export { useSelectionOverlayHandlers }
