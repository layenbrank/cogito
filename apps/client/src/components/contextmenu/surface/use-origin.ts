import { useLayoutEffect, useState, type RefObject } from 'react'

import {
  findContainerRect,
  OFFSET_BY_PLACEMENT,
  parseOrigin,
  type Point,
  type Rect
} from '@/components/contextmenu/position'
import type { ParsedMenuItem } from '@/components/contextmenu/menu'

interface SurfaceOrigin {
  left: number
  top: number
  flipX: boolean
  flipY: boolean
}

interface UseSurfaceOriginOptions {
  surfaceRef: RefObject<HTMLDivElement | null>
  anchor: Point | Rect
  placement: 'pointer' | 'submenu'
  offset?: [number, number]
  submenuOffset?: [number, number]
  boundaryPadding?: number
  container: HTMLElement
  preferRight?: boolean
  items: ParsedMenuItem[]
  expanded: ParsedMenuItem | undefined
  path: string[]
}

interface SurfaceOriginState {
  origin: SurfaceOrigin
  isMeasured: boolean
  childAnchor: Rect | null
}

function useSurfaceOrigin(options: UseSurfaceOriginOptions): SurfaceOriginState {
  const [origin, setOrigin] = useState<SurfaceOrigin>({
    left: -9999,
    top: -9999,
    flipX: false,
    flipY: false
  })
  const [isMeasured, setMeasured] = useState(false)
  const [childAnchor, setChildAnchor] = useState<Rect | null>(null)

  useLayoutEffect(
    function () {
      const el = options.surfaceRef.current
      if (!el) return

      // 测量必须在布局后；放入 rAF 避免 effect 体内同步 setState
      const frame = requestAnimationFrame(function () {
        const next = parseOrigin({
          anchor: options.anchor,
          size: { width: el.offsetWidth, height: el.offsetHeight },
          placement: options.placement,
          offset:
            options.placement === 'submenu'
              ? (options.submenuOffset ?? OFFSET_BY_PLACEMENT.submenu)
              : (options.offset ?? OFFSET_BY_PLACEMENT.pointer),
          padding: options.boundaryPadding,
          containerRect: findContainerRect(options.container, options.boundaryPadding),
          preferRight: options.preferRight
        })

        setOrigin(next)
        setMeasured(true)

        if (!options.expanded) {
          setChildAnchor(null)
          return
        }
        const row = el.querySelector<HTMLElement>(
          `[data-contextmenu-key="${CSS.escape(options.expanded.key)}"]`
        )
        if (!row) {
          setChildAnchor(null)
          return
        }
        const box = row.getBoundingClientRect()
        setChildAnchor({
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom
        })
      })

      return function () {
        cancelAnimationFrame(frame)
      }
    },
    [
      options.anchor,
      options.boundaryPadding,
      options.container,
      options.offset,
      options.placement,
      options.preferRight,
      options.submenuOffset,
      options.items,
      options.expanded,
      options.path,
      options.surfaceRef
    ]
  )

  return { origin, isMeasured, childAnchor }
}

export type { SurfaceOrigin, SurfaceOriginState, UseSurfaceOriginOptions }
export { useSurfaceOrigin }
