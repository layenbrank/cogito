// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

import { isValidPosition } from '@/lib/tiptap-utils.ts'

interface ResizeParams {
  handleUsed: 'left' | 'right'
  initialWidth: number
  initialClientX: number
}

interface UseImageResizeOptions {
  editor?: Editor
  align?: 'left' | 'center' | 'right'
  minWidth: number
  maxWidth: number
  initialWidth?: number
  getPos: () => number | undefined
  onImageResize?: (width?: number) => void
}

function useImageResize(options: UseImageResizeOptions) {
  const [resizeParams, setResizeParams] = useState<ResizeParams | undefined>()
  const [width, setWidth] = useState<number | undefined>(options.initialWidth)
  const [showHandles, setShowHandles] = useState(false)
  const isResizingRef = useRef(false)
  const isMountedRef = useRef(true)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const leftResizeHandleRef = useRef<HTMLButtonElement>(null)
  const rightResizeHandleRef = useRef<HTMLButtonElement>(null)

  const windowMouseMoveHandler = useCallback(
    function (event: MouseEvent | TouchEvent) {
      if (!resizeParams || !options.editor || !isMountedRef.current) return

      const clientX =
        'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX
      const isLeftHandle = resizeParams.handleUsed === 'left'
      const multiplier = options.align === 'center' ? 2 : 1
      const delta = isLeftHandle
        ? (resizeParams.initialClientX - clientX) * multiplier
        : (clientX - resizeParams.initialClientX) * multiplier
      const newWidth = resizeParams.initialWidth + delta
      const effectiveMaxWidth =
        options.editor.view.dom?.firstElementChild?.clientWidth || options.maxWidth
      const clampedWidth = Math.min(
        Math.max(newWidth, options.minWidth),
        effectiveMaxWidth
      )

      setWidth(clampedWidth)
      if (wrapperRef.current) {
        wrapperRef.current.style.width = `${clampedWidth}px`
      }
    },
    [options.editor, options.align, options.maxWidth, options.minWidth, resizeParams]
  )

  const windowMouseUpHandler = useCallback(
    function (event: MouseEvent | TouchEvent) {
      if (!options.editor || !isMountedRef.current) return

      const target =
        'touches' in event
          ? document.elementFromPoint(
              event.changedTouches[0]?.clientX ?? 0,
              event.changedTouches[0]?.clientY ?? 0
            )
          : event.target

      const isInsideWrapper =
        target && wrapperRef.current?.contains(target as Node)

      if (
        (!isInsideWrapper || !options.editor.isEditable) &&
        showHandles &&
        isMountedRef.current
      ) {
        setShowHandles(false)
      }

      if (!resizeParams) return

      const wasNodeSelection =
        options.editor.state.selection instanceof NodeSelection &&
        options.editor.state.selection.node.type.name === 'image'

      if (isMountedRef.current) {
        setResizeParams(undefined)
      }
      options.onImageResize?.(width)

      const pos = options.getPos()
      if (isValidPosition(pos) && wasNodeSelection && isMountedRef.current) {
        options.editor.chain().focus().setNodeSelection(pos).run()
      }

      isResizingRef.current = false
    },
    [options.editor, options.getPos, options.onImageResize, resizeParams, showHandles, width]
  )

  const startResize = useCallback(
    function (handleUsed: 'left' | 'right', clientX: number) {
      setResizeParams({
        handleUsed,
        initialWidth: wrapperRef.current?.clientWidth ?? options.minWidth,
        initialClientX: clientX
      })
      isResizingRef.current = true
    },
    [options.minWidth]
  )

  useEffect(
    function () {
      window.addEventListener('mousemove', windowMouseMoveHandler)
      window.addEventListener('mouseup', windowMouseUpHandler)
      window.addEventListener('touchmove', windowMouseMoveHandler, { passive: false })
      window.addEventListener('touchend', windowMouseUpHandler)
      return function () {
        window.removeEventListener('mousemove', windowMouseMoveHandler)
        window.removeEventListener('mouseup', windowMouseUpHandler)
        window.removeEventListener('touchmove', windowMouseMoveHandler)
        window.removeEventListener('touchend', windowMouseUpHandler)
      }
    },
    [windowMouseMoveHandler, windowMouseUpHandler]
  )

  useEffect(function () {
    return function () {
      isMountedRef.current = false
    }
  }, [])

  return {
    resizeParams,
    width,
    showHandles,
    setShowHandles,
    wrapperRef,
    leftResizeHandleRef,
    rightResizeHandleRef,
    startResize
  }
}

export { useImageResize }
