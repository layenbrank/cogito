import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, type RefObject } from 'react'
import { CHANNELS } from '@/shared/ipc/channels'

const HIT_SELECTOR = "[data-region='false']"

type ThroughRect = { x: number; y: number; w: number; h: number }

interface ThroughOptions {
  rootRef: RefObject<HTMLElement | null>
  enabled?: boolean
}

function parseRect(el: Element): ThroughRect | null {
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    w: Math.round(box.width),
    h: Math.round(box.height)
  }
}

function findHitRects(root: HTMLElement): ThroughRect[] {
  const rects: ThroughRect[] = []
  const seen = new Set<Element>()

  function push(el: Element) {
    if (seen.has(el)) return
    seen.add(el)
    const rect = parseRect(el)
    if (rect) rects.push(rect)
  }

  if (root.matches(HIT_SELECTOR)) push(root)
  const nodes = root.querySelectorAll(HIT_SELECTOR)
  for (const node of nodes) push(node)

  return rects
}

function clearSource(source: string) {
  void invoke(CHANNELS.THROUGH.UPDATE_RECTS, {
    source,
    rects: [] as ThroughRect[]
  }).catch(function (error: unknown) {
    console.debug('[through] 清空穿透区失败:', error)
  })
}

function publishRects(source: string, rects: ThroughRect[]) {
  void invoke(CHANNELS.THROUGH.UPDATE_RECTS, { source, rects }).catch(function (error: unknown) {
    console.debug('[through] 更新穿透区失败:', error)
  })
}

/**
 * Report hit-rects of `[data-region='false']` under root to the overlay through worker.
 * `enabled=false` clears the source (e.g. pin click-through).
 */
function useThrough(source: string, options: ThroughOptions) {
  const { rootRef, enabled = true } = options
  const sourceRef = useRef(source)

  useEffect(
    function () {
      sourceRef.current = source
    },
    [source]
  )

  useEffect(
    function () {
      if (!enabled) {
        clearSource(source)
        return
      }

      const root = rootRef.current
      if (!root) return

      let frame = 0

      function sync() {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(function () {
          const el = rootRef.current
          if (!el) return
          publishRects(sourceRef.current, findHitRects(el))
        })
      }

      const ro = new ResizeObserver(sync)
      ro.observe(root)

      const mo = new MutationObserver(sync)
      mo.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['style', 'class', 'data-region']
      })

      sync()
      return function () {
        cancelAnimationFrame(frame)
        ro.disconnect()
        mo.disconnect()
        clearSource(sourceRef.current)
      }
    },
    [enabled, rootRef, source]
  )
}

export type { ThroughOptions, ThroughRect }
export { useThrough, findHitRects, HIT_SELECTOR }
