import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { readWorkArea, type CaptureRect } from '@/features/capture/tauri'

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
 * 浮层按监视器**物理矩形**铺满（含任务栏那条），所以 `innerHeight` 不是安全边界：
 * 任务栏是 topmost，永远压在浮层上面 —— 整屏选区把工具栏贴到屏幕底部就钻进任务栏后面。
 * 任务栏自动隐藏时工作区等于整屏，此时仍按 `GAP` 内缩，避开任务栏探出的那一条。
 */
function resolveBounds(work: CaptureRect | null) {
  if (work) {
    return { left: work.x, top: work.y, right: work.x + work.w, bottom: work.y + work.h }
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
}

/** 工具栏跟随选区下沿定位：下方装不下翻到上沿；右侧/下方一律夹在可用区里 */
function useUtilityPosition(
  selection: SelectionRect | null,
  active: unknown
): {
  containerRef: RefObject<HTMLDivElement | null>
  position: UtilityPosition
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<UtilityPosition>({ top: 0, left: 0 })
  /** 可用区由宿主给（一次截屏会话内不变）；拿不到就退回整屏 */
  const [work, setWork] = useState<CaptureRect | null>(null)

  useEffect(function () {
    let alive = true
    void readWorkArea()
      .then(function (rect) {
        if (alive && rect) setWork(rect)
      })
      .catch(function (error: unknown) {
        // 读不到就用整屏兜底：工具栏最多贴边，不能因此不显示
        console.warn('[capture] 读取可用区失败，工具栏按整屏定位', error)
      })
    return function () {
      alive = false
    }
  }, [])

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
