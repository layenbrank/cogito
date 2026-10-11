import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

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

/** 工具栏跟随选区下沿定位：下方装不下翻到上沿；右贴边时水平内收 */
function useUtilityPosition(
  selection: SelectionRect | null,
  active: unknown
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
      const GAP = 8
      const rect = node.getBoundingClientRect()
      const W = window.innerWidth
      const H = window.innerHeight
      let top = selection.y + selection.h + GAP
      if (top + rect.height + GAP > H) {
        const above = selection.y - rect.height - GAP
        top = above >= GAP ? above : Math.max(GAP, H - rect.height - GAP)
      }
      let left = selection.x
      if (left + rect.width + GAP > W) left = W - rect.width - GAP
      if (left < GAP) left = GAP
      setPosition(function (prev) {
        if (prev.top === top && prev.left === left) return prev
        return { top, left }
      })
    },
    [selection, active]
  )

  return { containerRef, position }
}

export type { SelectionRect, UtilityPosition }
export { useUtilityPosition }
