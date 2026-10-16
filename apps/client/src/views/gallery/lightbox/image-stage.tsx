import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Image as KonvaImage } from 'react-konva'

import {
  CanvasStage,
  clampPan,
  findViewportScaleRange,
  fitViewport,
  VIEWPORT_WHEEL_FACTOR,
  zoomAtPointer,
  type Size,
  type Viewport
} from '@/lib/canvas'

interface GalleryImageStageProps {
  src: string
  onZoomedChange?(zoomed: boolean): void
  onScaleChange?(ratio: number): void
}

function GalleryImageStage(props: GalleryImageStageProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [view, setView] = useState<Size>({ width: 1, height: 1 })
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 })
  const viewportRef = useRef(viewport)
  const userZoomedRef = useRef(false)
  const dragRef = useRef<{
    pointerX: number
    pointerY: number
    originX: number
    originY: number
  } | null>(null)
  const onZoomedChangeRef = useRef(props.onZoomedChange)
  const onScaleChangeRef = useRef(props.onScaleChange)
  const hostRef = useRef<HTMLDivElement>(null)

  // 视口尺寸自己量：不再通过 CanvasStage 的 onMetricsChange 回调绕一圈
  useLayoutEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      function measure() {
        const el = hostRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const width = Math.max(1, rect.width)
        const height = Math.max(1, rect.height)
        setView(function (prev) {
          if (prev.width === width && prev.height === height) return prev
          return { width, height }
        })
      }

      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(host)
      return function () {
        observer.disconnect()
      }
    },
    []
  )

  useEffect(
    function () {
      onZoomedChangeRef.current = props.onZoomedChange
      onScaleChangeRef.current = props.onScaleChange
    },
    [props.onZoomedChange, props.onScaleChange]
  )

  const contentWidth = image?.naturalWidth || 1
  const contentHeight = image?.naturalHeight || 1
  const content: Size = {
    width: contentWidth,
    height: contentHeight
  }

  useEffect(
    function () {
      let cancelled = false
      userZoomedRef.current = false
      const next = new Image()
      next.crossOrigin = 'anonymous'
      next.decoding = 'async'
      next.onload = function () {
        if (!cancelled) setImage(next)
      }
      next.onerror = function () {
        if (!cancelled) setImage(null)
      }
      next.src = props.src
      return function () {
        cancelled = true
      }
    },
    [props.src]
  )

  useEffect(
    function () {
      if (!image || userZoomedRef.current) return
      const next = fitViewport(
        { width: view.width, height: view.height },
        { width: contentWidth, height: contentHeight }
      )
      viewportRef.current = next
      setViewport(function (prev) {
        if (prev.scale === next.scale && prev.x === next.x && prev.y === next.y) return prev
        return next
      })
    },
    [image, view.width, view.height, contentWidth, contentHeight]
  )

  useEffect(
    function () {
      return function () {
        onZoomedChangeRef.current?.(false)
        onScaleChangeRef.current?.(1)
      }
    },
    []
  )

  function commitViewport(next: Viewport) {
    viewportRef.current = next
    setViewport(next)
    const range = findViewportScaleRange(view, content)
    const ratio = range.min > 0 ? next.scale / range.min : 1
    const zoomed = ratio > 1.001
    onZoomedChangeRef.current?.(zoomed)
    onScaleChangeRef.current?.(ratio)
  }

  function resetViewport() {
    userZoomedRef.current = false
    const next = fitViewport(view, content)
    viewportRef.current = next
    setViewport(next)
    onZoomedChangeRef.current?.(false)
    onScaleChangeRef.current?.(1)
  }

  function onWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault()
    event.evt.stopPropagation()
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer || !image) return
    const range = findViewportScaleRange(view, content)
    const factor = event.evt.deltaY > 0 ? 1 / VIEWPORT_WHEEL_FACTOR : VIEWPORT_WHEEL_FACTOR
    const zoomed = zoomAtPointer(viewportRef.current, pointer, factor, range.min, range.max)
    userZoomedRef.current = zoomed.scale > range.min * 1.001
    commitViewport(clampPan(zoomed, view, content))
  }

  function onPointerDown(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer || !image) return
    const range = findViewportScaleRange(view, content)
    if (viewportRef.current.scale <= range.min * 1.001) return
    event.evt.stopPropagation()
    dragRef.current = {
      pointerX: pointer.x,
      pointerY: pointer.y,
      originX: viewportRef.current.x,
      originY: viewportRef.current.y
    }
  }

  function onPointerMove(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const drag = dragRef.current
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!drag || !pointer) return
    event.evt.stopPropagation()
    commitViewport(
      clampPan(
        {
          scale: viewportRef.current.scale,
          x: drag.originX + (pointer.x - drag.pointerX),
          y: drag.originY + (pointer.y - drag.pointerY)
        },
        view,
        content
      )
    )
  }

  function onPointerUp() {
    dragRef.current = null
  }

  const fitScale = image ? findViewportScaleRange(view, content).min : 1
  const isZoomed = viewport.scale > fitScale * 1.001

  return (
    <div
      ref={hostRef}
      className="absolute inset-0">
      {image ? (
        <CanvasStage
          className={isZoomed ? 'h-full w-full cursor-grab' : 'h-full w-full'}
          contentSize={content}
          fitContent={false}
          viewport={viewport}
          onStageWheel={onWheel}
          onStageMouseDown={onPointerDown}
          onStageMouseMove={onPointerMove}
          onStageMouseUp={onPointerUp}
          onStageDblClick={function () {
            resetViewport()
          }}
          media={
            <KonvaImage
              image={image}
              width={content.width}
              height={content.height}
              listening={false}
            />
          }
        />
      ) : null}
    </div>
  )
}

export { GalleryImageStage }
