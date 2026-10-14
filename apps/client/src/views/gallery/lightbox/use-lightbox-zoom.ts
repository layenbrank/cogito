import gsap from 'gsap'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  LIGHTBOX_ZOOM_MAX,
  LIGHTBOX_ZOOM_MIN,
  LIGHTBOX_ZOOM_STEP
} from '@/views/gallery/constraints'

interface UseLightboxZoomOptions {
  stageRef: RefObject<HTMLElement | null>
  /** 绝对定位于舞台内；x/y 为左上角（transformOrigin 0 0） */
  targetRef: RefObject<HTMLElement | null>
  resetKey: string | number | null
  enabled: boolean
  fitWidth: number
  fitHeight: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** 小于舞台居中可拖；大于舞台允许负偏移以看全图 */
function findPanRange(bounds: number, rendered: number) {
  const min = Math.min(0, bounds - rendered)
  const max = Math.max(0, bounds - rendered)
  return { min, max }
}

function clearTargetStyles(target: HTMLElement | null) {
  if (!target) return
  gsap.killTweensOf(target)
  gsap.set(target, { clearProps: 'width,height,x,y,transform,scale,left,top' })
}

/**
 * Ctrl/⌘+滚轮：以光标为锚缩放（改 width/height，保持清晰度）。
 * 坐标相对舞台，左上角定位——不再用 flex 居中 + 中心锚点（会漂）。
 */
function useLightboxZoom(options: UseLightboxZoomOptions) {
  const [scale, onScale] = useState(1)
  const live = useRef({ scale: 1, x: 0, y: 0 })
  const fitRef = useRef({ w: options.fitWidth, h: options.fitHeight })
  const lastTargetRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  fitRef.current = { w: options.fitWidth, h: options.fitHeight }

  /** 媒体的定位容器（SwiperSlide）；与光标坐标同一坐标系 */
  function findBoundsEl() {
    const target = options.targetRef.current
    if (target?.offsetParent instanceof HTMLElement) return target.offsetParent
    return options.stageRef.current
  }

  function findStageSize() {
    const bounds = findBoundsEl()
    if (!bounds) return { w: 0, h: 0 }
    return { w: bounds.clientWidth, h: bounds.clientHeight }
  }

  function clampPan(x: number, y: number, s: number) {
    const stage = findStageSize()
    const { w, h } = fitRef.current
    const rangeX = findPanRange(stage.w, w * s)
    const rangeY = findPanRange(stage.h, h * s)
    return {
      x: clamp(x, rangeX.min, rangeX.max),
      y: clamp(y, rangeY.min, rangeY.max)
    }
  }

  function findCenteredOrigin(s = 1) {
    const stage = findStageSize()
    const { w, h } = fitRef.current
    return {
      x: (stage.w - w * s) / 2,
      y: (stage.h - h * s) / 2
    }
  }

  function applyLayout() {
    const target = options.targetRef.current
    if (!target) return
    lastTargetRef.current = target
    const { w, h } = fitRef.current
    const s = live.current.scale
    const pan = clampPan(live.current.x, live.current.y, s)
    live.current.x = pan.x
    live.current.y = pan.y
    gsap.set(target, {
      width: Math.max(1, w * s),
      height: Math.max(1, h * s),
      x: pan.x,
      y: pan.y,
      scale: 1,
      transformOrigin: '0 0',
      force3D: true
    })
  }

  function resetZoom() {
    live.current = { scale: 1, x: 0, y: 0 }
    const origin = findCenteredOrigin(1)
    live.current = { scale: 1, x: origin.x, y: origin.y }
    onScale(1)
    drag.current = null

    const current = options.targetRef.current
    const previous = lastTargetRef.current
    if (previous && previous !== current) clearTargetStyles(previous)
    clearTargetStyles(current)
    lastTargetRef.current = current
    applyLayout()
  }

  useLayoutEffect(
    function () {
      if (!options.enabled || options.resetKey == null) {
        live.current = { scale: 1, x: 0, y: 0 }
        onScale(1)
        clearTargetStyles(options.targetRef.current)
        clearTargetStyles(lastTargetRef.current)
        lastTargetRef.current = null
        return
      }
      resetZoom()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.resetKey, options.enabled]
  )

  useLayoutEffect(
    function () {
      if (!options.enabled || options.resetKey == null) return
      // fit 晚到：若仍是 100%，重新居中；已缩放则只按新 fit 重算尺寸并钳制平移
      if (live.current.scale <= 1.001) {
        const origin = findCenteredOrigin(1)
        live.current.x = origin.x
        live.current.y = origin.y
      }
      applyLayout()
    },
    [options.fitWidth, options.fitHeight]
  )

  useEffect(
    function () {
      if (!options.enabled) return
      const stage = options.stageRef.current
      if (!stage) return

      function onWheel(event: WheelEvent) {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        event.stopPropagation()

        const target = options.targetRef.current
        if (!target) return

        const oldScale = live.current.scale
        const delta = event.deltaY > 0 ? -LIGHTBOX_ZOOM_STEP : LIGHTBOX_ZOOM_STEP
        const next =
          Math.round(clamp(oldScale + delta, LIGHTBOX_ZOOM_MIN, LIGHTBOX_ZOOM_MAX) * 100) / 100
        if (next === oldScale) return

        const bounds = findBoundsEl()
        if (!bounds) return
        const boundsRect = bounds.getBoundingClientRect()
        // 光标相对定位容器；内容坐标用 fit 空间（÷ oldScale）
        const mouseX = event.clientX - boundsRect.left
        const mouseY = event.clientY - boundsRect.top
        const contentX = (mouseX - live.current.x) / oldScale
        const contentY = (mouseY - live.current.y) / oldScale
        const nextX = mouseX - contentX * next
        const nextY = mouseY - contentY * next

        if (next <= 1.001) {
          const origin = findCenteredOrigin(1)
          live.current = { scale: 1, x: origin.x, y: origin.y }
        } else {
          const pan = clampPan(nextX, nextY, next)
          live.current = { scale: next, x: pan.x, y: pan.y }
        }

        onScale(live.current.scale)
        applyLayout()
      }

      function onPointerDown(event: PointerEvent) {
        if (live.current.scale <= 1.001) return
        if (event.button !== 0) return
        // 避免拖到原生 video controls 时抢手势
        const path = event.composedPath()
        for (const node of path) {
          if (node instanceof HTMLVideoElement) return
        }
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: live.current.x,
          originY: live.current.y
        }
        stage.setPointerCapture(event.pointerId)
        stage.style.cursor = 'grabbing'
      }

      function onPointerMove(event: PointerEvent) {
        const session = drag.current
        if (!session || session.pointerId !== event.pointerId) return
        const nextX = session.originX + (event.clientX - session.startX)
        const nextY = session.originY + (event.clientY - session.startY)
        const pan = clampPan(nextX, nextY, live.current.scale)
        live.current.x = pan.x
        live.current.y = pan.y
        applyLayout()
      }

      function endDrag(event: PointerEvent) {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return
        drag.current = null
        stage.style.cursor = live.current.scale > 1 ? 'grab' : ''
        try {
          stage.releasePointerCapture(event.pointerId)
        } catch {
          /* already released */
        }
      }

      function onDblClick() {
        if (live.current.scale > 1.001) {
          resetZoom()
          stage.style.cursor = ''
        }
      }

      stage.addEventListener('wheel', onWheel, { passive: false })
      stage.addEventListener('pointerdown', onPointerDown)
      stage.addEventListener('pointermove', onPointerMove)
      stage.addEventListener('pointerup', endDrag)
      stage.addEventListener('pointercancel', endDrag)
      stage.addEventListener('dblclick', onDblClick)

      return function () {
        stage.removeEventListener('wheel', onWheel)
        stage.removeEventListener('pointerdown', onPointerDown)
        stage.removeEventListener('pointermove', onPointerMove)
        stage.removeEventListener('pointerup', endDrag)
        stage.removeEventListener('pointercancel', endDrag)
        stage.removeEventListener('dblclick', onDblClick)
        stage.style.cursor = ''
      }
    },
    [options.enabled, options.stageRef, options.targetRef, options.resetKey]
  )

  return {
    scale,
    isZoomed: scale > 1.001,
    resetZoom
  }
}

export { useLightboxZoom }
export type { UseLightboxZoomOptions }
