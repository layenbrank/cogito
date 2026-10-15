import { useEffect, useRef } from 'react'
import type Konva from 'konva'

/**
 * 播放时对指定 Layer（或 Stage）做 requestAnimationFrame → batchDraw，
 * 让绑了 HTMLVideoElement 的 Konva.Image 刷新帧。
 */
function useMediaClock(options: {
  active: boolean
  target: Konva.Layer | Konva.Stage | null | undefined
}) {
  const { active, target } = options
  const rafRef = useRef(0)

  useEffect(() => {
    if (!active || !target) return

    let alive = true
    function tick() {
      if (!alive) return
      target!.batchDraw()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [active, target])
}

export { useMediaClock }
