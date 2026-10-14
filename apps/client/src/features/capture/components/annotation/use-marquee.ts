import type Konva from 'konva'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react'

import {
  clampPointToClip,
  findMarqueeHitIDs
} from './hit'
import type { Bounds } from '@/features/capture/components/graphics/geometry'
import type { GraphicsProps } from '@/features/capture/components/graphics/types'

/** 橡皮筋视为有效框选的最小对角线像素 */
const MIN_MARQUEE_PX = 3

/* React 19 起 `MutableRefObject` 已弃用：`RefObject` 本身就是可变 current */
interface UseAnnotationMarqueeOptions {
  stageRef: RefObject<Konva.Stage | null>
  annotationsRef: RefObject<GraphicsProps[]>
  clipRectRef: RefObject<{ x: number; y: number; w: number; h: number } | null>
  onSelectRef: RefObject<(id: string | null, options?: { additive?: boolean }) => void>
  onSelectManyRef: RefObject<((ids: string[]) => void) | undefined>
}

interface AnnotationMarqueeApi {
  marqueeStartRef: RefObject<{ x: number; y: number } | null>
  marqueeBox: Bounds | null
  ignoreSelectClickRef: RefObject<boolean>
  beginMarquee(this: void, start: { x: number; y: number }): void
}

interface MarqueeHandlers {
  move: (native: MouseEvent) => void
  up: () => void
}

function useAnnotationMarquee(options: UseAnnotationMarqueeOptions): AnnotationMarqueeApi {
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeBoxRef = useRef<Bounds | null>(null)
  const ignoreSelectClickRef = useRef(false)
  const [marqueeBox, updateMarqueeBox] = useState<Bounds | null>(null)
  const optionsRef = useRef(options)
  const handlersRef = useRef<MarqueeHandlers | null>(null)

  useLayoutEffect(function () {
    optionsRef.current = options
  })

  useEffect(function () {
    return function () {
      const handlers = handlersRef.current
      if (!handlers) return
      window.removeEventListener('mousemove', handlers.move)
      window.removeEventListener('mouseup', handlers.up)
    }
  }, [])

  function ensureHandlers(): MarqueeHandlers {
    if (handlersRef.current) return handlersRef.current

    const handlers: MarqueeHandlers = {
      move(native: MouseEvent) {
        const current = optionsRef.current
        const stage = current.stageRef.current
        if (!stage || !marqueeStartRef.current) return
        const rect = stage.container().getBoundingClientRect()
        const scaleX = stage.width() / Math.max(rect.width, 1)
        const scaleY = stage.height() / Math.max(rect.height, 1)
        const pt = clampPointToClip(
          {
            x: (native.clientX - rect.left) * scaleX,
            y: (native.clientY - rect.top) * scaleY
          },
          current.clipRectRef.current
        )
        const start = marqueeStartRef.current
        const box: Bounds = {
          x: Math.min(start.x, pt.x),
          y: Math.min(start.y, pt.y),
          w: Math.abs(pt.x - start.x),
          h: Math.abs(pt.y - start.y)
        }
        marqueeBoxRef.current = box
        updateMarqueeBox(box)
      },
      up() {
        const current = optionsRef.current
        if (!marqueeStartRef.current) return
        marqueeStartRef.current = null
        window.removeEventListener('mousemove', handlers.move)
        window.removeEventListener('mouseup', handlers.up)
        const box = marqueeBoxRef.current
        marqueeBoxRef.current = null
        updateMarqueeBox(null)
        const diag = box ? Math.hypot(box.w, box.h) : 0
        if (!box || diag < MIN_MARQUEE_PX) return
        const ids = findMarqueeHitIDs(
          current.annotationsRef.current,
          box,
          current.stageRef.current
        )
        ignoreSelectClickRef.current = true
        window.setTimeout(function () {
          ignoreSelectClickRef.current = false
        }, 0)
        if (current.onSelectManyRef.current) {
          current.onSelectManyRef.current(ids)
        } else if (ids.length === 0) {
          current.onSelectRef.current(null)
        } else {
          current.onSelectRef.current(ids[ids.length - 1] ?? null)
        }
      }
    }

    handlersRef.current = handlers
    return handlers
  }

  function beginMarquee(start: { x: number; y: number }) {
    const handlers = ensureHandlers()
    marqueeStartRef.current = start
    const box: Bounds = { x: start.x, y: start.y, w: 0, h: 0 }
    marqueeBoxRef.current = box
    updateMarqueeBox(box)
    window.addEventListener('mousemove', handlers.move)
    window.addEventListener('mouseup', handlers.up)
  }

  return {
    marqueeStartRef,
    marqueeBox,
    ignoreSelectClickRef,
    beginMarquee
  }
}

export type { AnnotationMarqueeApi, UseAnnotationMarqueeOptions }
export { useAnnotationMarquee }
