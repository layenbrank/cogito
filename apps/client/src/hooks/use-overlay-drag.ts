import gsap from 'gsap'
import { useCallback, useEffect, useRef } from 'react'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * 按「缩放后渲染尺寸」计算可拖范围。
 * 小于舞台：限制在 [0, bounds - size]；
 * 大于舞台：允许负偏移，保证仍能平移看全图。
 */
function findDragRange(bounds: number, rendered: number) {
  const min = Math.min(0, bounds - rendered)
  const max = Math.max(0, bounds - rendered)
  return { min, max }
}

/** 阻尼跟随系数：0→无跟随，1→即时跟随 */
const DAMPING = 0.1

interface UseOverlayDragOptions {
  rootRef: React.RefObject<HTMLElement | null>
  id: string
  storeX: number
  storeY: number
  elWidth: number
  elHeight: number
  boundsWidth: number
  boundsHeight: number
  /** 当前缩放（贴图滚轮放大后必须传入，默认 1） */
  scale?: number
  /** 超过该像素才算拖拽（tile 用 6，texture 用 0） */
  threshold?: number
  onCommit: (x: number, y: number) => void
  onDragStateChange?: (isDragging: boolean) => void
}

function useOverlayDrag(options: UseOverlayDragOptions) {
  const {
    rootRef,
    storeX,
    storeY,
    elWidth,
    elHeight,
    boundsWidth,
    boundsHeight,
    scale = 1,
    threshold = 0,
    onCommit,
    onDragStateChange
  } = options

  /** 用 ref 穿透闭包，确保稳定回调始终读到最新 props */
  const latestRef = useRef({
    storeX,
    storeY,
    elWidth,
    elHeight,
    boundsWidth,
    boundsHeight,
    scale,
    threshold,
    onCommit,
    onDragStateChange
  })

  useEffect(
    function () {
      latestRef.current = {
        storeX,
        storeY,
        elWidth,
        elHeight,
        boundsWidth,
        boundsHeight,
        scale,
        threshold,
        onCommit,
        onDragStateChange
      }
    },
    [
      storeX,
      storeY,
      elWidth,
      elHeight,
      boundsWidth,
      boundsHeight,
      scale,
      threshold,
      onCommit,
      onDragStateChange
    ]
  )

  const dragRef = useRef<{
    pointerId: number
    originX: number
    originY: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const dampingTargetRef = useRef<{ x: number; y: number } | null>(null)

  const dampingTick = useCallback(function tick() {
    const target = dampingTargetRef.current
    if (!target) {
      gsap.ticker.remove(tick)
      return
    }
    const el = rootRef.current
    if (!el) return

    const cx = Number(gsap.getProperty(el, 'x')) || 0
    const cy = Number(gsap.getProperty(el, 'y')) || 0
    const nx = cx + (target.x - cx) * DAMPING
    const ny = cy + (target.y - cy) * DAMPING

    if (Math.abs(target.x - nx) < 0.5 && Math.abs(target.y - ny) < 0.5) {
      gsap.set(el, { x: target.x, y: target.y })
      dampingTargetRef.current = null
      gsap.ticker.remove(tick)
      latestRef.current.onCommit(target.x, target.y)
      return
    }

    gsap.set(el, { x: nx, y: ny })

    if (Math.abs(target.x - nx) < 1 && Math.abs(target.y - ny) < 1) {
      gsap.set(el, { x: target.x, y: target.y })
      dampingTargetRef.current = null
      gsap.ticker.remove(tick)
      latestRef.current.onCommit(target.x, target.y)
    }
  }, [rootRef])

  const stopDamping = useCallback(function () {
    gsap.ticker.remove(dampingTick)
  }, [dampingTick])

  const handlePointerDown = useCallback(
    function (e: React.PointerEvent) {
      if (e.button !== 0) return
      const el = rootRef.current
      if (!el) return

      stopDamping()

      const actualX = Number(gsap.getProperty(el, 'x')) || 0
      const actualY = Number(gsap.getProperty(el, 'y')) || 0
      gsap.set(el, { x: actualX, y: actualY })
      dampingTargetRef.current = null
      dragRef.current = {
        pointerId: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        startX: actualX,
        startY: actualY,
        moved: false
      }
    },
    [rootRef, stopDamping]
  )

  const handlePointerMove = useCallback(
    function (e: React.PointerEvent) {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const el = rootRef.current
      if (!el) return

      const {
        boundsWidth: bw,
        boundsHeight: bh,
        elWidth: ew,
        elHeight: eh,
        scale: sc,
        threshold: th,
        onDragStateChange: onDSC
      } = latestRef.current

      // 边界必须按缩放后视觉尺寸计算（与 useWheelScale 一致）
      const rangeX = findDragRange(bw, ew * sc)
      const rangeY = findDragRange(bh, eh * sc)

      const dx = e.clientX - drag.originX
      const dy = e.clientY - drag.originY

      if (!drag.moved && Math.hypot(dx, dy) >= th) {
        drag.moved = true
        onDSC?.(true)
        el.setPointerCapture(e.pointerId)
      }
      if (!drag.moved) return

      const tx = clamp(drag.startX + dx, rangeX.min, rangeX.max)
      const ty = clamp(drag.startY + dy, rangeY.min, rangeY.max)
      dampingTargetRef.current = { x: tx, y: ty }

      gsap.ticker.add(dampingTick)
    },
    [rootRef, dampingTick]
  )

  const handlePointerUp = useCallback(
    function (e: React.PointerEvent) {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const el = rootRef.current

      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch (error) {
        console.debug('[overlay-drag] pointer capture 已经释放过了:', error)
      }

      latestRef.current.onDragStateChange?.(false)

      if (!drag.moved || !el) {
        stopDamping()
        dampingTargetRef.current = null
        dragRef.current = null
        return
      }

      const finalTarget = {
        x: Number(gsap.getProperty(el, 'x')) || 0,
        y: Number(gsap.getProperty(el, 'y')) || 0
      }
      dampingTargetRef.current = finalTarget
      dragRef.current = null
    },
    [rootRef, stopDamping]
  )

  const handlePointerCancel = useCallback(function () {
    const drag = dragRef.current
    if (!drag) return
    stopDamping()
    dampingTargetRef.current = null
    dragRef.current = null
    latestRef.current.onDragStateChange?.(false)
  }, [stopDamping])

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel
  }
}

export { useOverlayDrag, findDragRange }
export type { UseOverlayDragOptions }
