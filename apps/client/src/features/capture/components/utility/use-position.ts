import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

import type { CaptureRect } from '@/apis/capture'

interface SelectionRect {
  x: number
  y: number
  w: number
  h: number
}

interface UtilityPosition {
  top: number
  left: number
}

/** 工具栏与选区 / 可用区边缘的间距 */
const GAP = 8

/**
 * 可用区：整屏扣掉任务栏后那块（overlay 局部 CSS 像素）。
 *
 * 浮层铺满**整屏**（含任务栏那条），而任务栏常驻 topmost —— 拿视口边缘当边界，
 * 整屏选区就会把工具栏贴到任务栏后面去。`work` 为 null（读不到可用区）时才退回整屏。
 */
function resolveBounds(work: CaptureRect | null) {
  if (work) {
    return { left: work.x, top: work.y, right: work.x + work.w, bottom: work.y + work.h }
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
}

/**
 * 工具栏跟随选区定位：默认贴选区下沿；下方装不下翻到上沿；上下都装不下（整屏选区）
 * 就贴可用区底边。左右与上下最终都夹在可用区里。
 *
 * 纯函数式（入参只有选区、可用区），IO 由调用方在截屏会话开始时做一次。
 */
function useUtilityPosition(
  selection: SelectionRect | null,
  active: unknown,
  work: CaptureRect | null
): {
  containerRef: RefObject<HTMLDivElement | null>
  position: UtilityPosition
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<UtilityPosition>({ top: 0, left: 0 })

  useLayoutEffect(
    function () {
      if (!selection) return
      const node = containerRef.current
      if (!node) return
      const box = resolveBounds(work)
      // `offsetWidth/Height` 才是布局尺寸：入场动画带 scale/translate，
      // `getBoundingClientRect()` 量到的是缩小后的值，会让「下方装不下」判错。
      const width = node.offsetWidth
      const height = node.offsetHeight

      let top = selection.y + selection.h + GAP
      if (top + height + GAP > box.bottom) {
        // 下方装不下 → 翻到选区上沿；上下都装不下（整屏选区）→ 贴可用区底边
        const above = selection.y - height - GAP
        top = above >= box.top + GAP ? above : box.bottom - height - GAP
      }
      let left = selection.x
      if (left + width + GAP > box.right) left = box.right - width - GAP
      // 统一夹一次：整屏选区 + 超高工具栏时也不能越过可用区
      top = Math.min(
        Math.max(top, box.top + GAP),
        Math.max(box.top + GAP, box.bottom - height - GAP)
      )
      left = Math.min(
        Math.max(left, box.left + GAP),
        Math.max(box.left + GAP, box.right - width - GAP)
      )

      setPosition(function (prev) {
        if (prev.top === top && prev.left === left) return prev
        return { top, left }
      })
    },
    [selection, active, work]
  )

  return { containerRef, position }
}

export type { SelectionRect, UtilityPosition }
export { useUtilityPosition }
