import gsap from 'gsap'
import { useEffect, useRef } from 'react'

import { findDragRange } from '@/hooks/use-overlay-drag'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

interface UseWheelScaleOptions {
  rootRef: React.RefObject<HTMLElement | null>
  storeScale: number
  storeX: number
  storeY: number
  /** 元素原始宽度（未缩放） */
  elWidth: number
  /** 元素原始高度（未缩放） */
  elHeight: number
  /** 舞台宽度（用于 clamp 边界） */
  boundsWidth: number
  /** 舞台高度（用于 clamp 边界） */
  boundsHeight: number
  minScale?: number
  maxScale?: number
  step?: number
  onCommit: (scale: number, x: number, y: number) => void
  /** Ctrl+滚轮回调（用于调节 opacity 等） */
  onOpacityCommit?: (opacity: number) => void
  /** 当前 opacity（配合 onOpacityCommit 使用） */
  storeOpacity?: number
  opacityMin?: number
  opacityMax?: number
  opacityStep?: number
}

function useWheelScale(options: UseWheelScaleOptions) {
  const { rootRef, storeScale, storeX, storeY, storeOpacity = 1 } = options

  const liveScaleRef = useRef(storeScale)
  const liveXRef = useRef(storeX)
  const liveYRef = useRef(storeY)
  const liveOpacityRef = useRef(storeOpacity)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const optsRef = useRef(options)

  useEffect(
    function () {
      liveScaleRef.current = storeScale
      liveXRef.current = storeX
      liveYRef.current = storeY
      liveOpacityRef.current = storeOpacity
      optsRef.current = options
    },
    [storeScale, storeX, storeY, storeOpacity, options]
  )

  const handler = useRef(function (e: WheelEvent) {
    e.preventDefault()
    e.stopPropagation()
    const el = rootRef.current
    if (!el) return

    const {
      onCommit: commit,
      onOpacityCommit: opCommit,
      step: s = 0.05,
      minScale: mn = 0.25,
      maxScale: mx = 4,
      opacityMin: oMn = 0.15,
      opacityMax: oMx = 1,
      opacityStep: oS = 0.05,
      elWidth: ew,
      elHeight: eh,
      boundsWidth: bw,
      boundsHeight: bh
    } = optsRef.current

    if (e.ctrlKey && opCommit) {
      const delta = e.deltaY > 0 ? -oS : oS
      const next =
        Math.round(Math.min(oMx, Math.max(oMn, liveOpacityRef.current + delta)) * 100) / 100
      liveOpacityRef.current = next
      gsap.set(el, { opacity: next })

      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = setTimeout(function () {
        commitTimerRef.current = undefined
        opCommit(next)
      }, 200)
      return
    }

    const oldScale = liveScaleRef.current
    const delta = e.deltaY > 0 ? -s : s
    const newScale = Math.round(Math.min(mx, Math.max(mn, oldScale + delta)) * 100) / 100

    if (newScale === oldScale) return

    const curX = Number(gsap.getProperty(el, 'x')) || 0
    const curY = Number(gsap.getProperty(el, 'y')) || 0

    // transformOrigin = '0 0'：GSAP x/y 即元素左上角
    const mousePointX = (e.clientX - curX) / oldScale
    const mousePointY = (e.clientY - curY) / oldScale

    let newX = e.clientX - mousePointX * newScale
    let newY = e.clientY - mousePointY * newScale

    // 按缩放后渲染尺寸约束；大于舞台时允许负偏移以便平移查看
    const rangeX = findDragRange(bw, ew * newScale)
    const rangeY = findDragRange(bh, eh * newScale)
    newX = clamp(newX, rangeX.min, rangeX.max)
    newY = clamp(newY, rangeY.min, rangeY.max)

    liveScaleRef.current = newScale
    liveXRef.current = newX
    liveYRef.current = newY

    gsap.set(el, { scale: newScale, x: newX, y: newY, transformOrigin: '0 0' })

    clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(function () {
      commitTimerRef.current = undefined
      commit(newScale, newX, newY)
    }, 200)
  })

  useEffect(
    function () {
      const el = rootRef.current
      if (!el) return
      function onWheel(e: WheelEvent) {
        handler.current(e)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return function () {
        el.removeEventListener('wheel', onWheel)
      }
    },
    [rootRef]
  )
}

export { useWheelScale }
export type { UseWheelScaleOptions }
