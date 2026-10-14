import { useGSAP } from '@gsap/react'
import { useEffect, useRef } from 'react'

import { bindScrollFx, type ScrollFx } from '@/features/controller/lib/scroll-fx'

/** 图库网格略快于 Mirror，便于扫图定位 */
const GALLERY_SCROLL = {
  duration: 0.85,
  ease: 'expo.out'
} as const

/** Library 列表区：阻尼滚动；暴露 scrollToY 供 scrubber */
function useGalleryScroll(scroller: HTMLElement | null) {
  const fxRef = useRef<ScrollFx | null>(null)

  useGSAP(
    function () {
      if (!scroller) {
        fxRef.current = null
        return
      }
      const fx = bindScrollFx(scroller, GALLERY_SCROLL)
      fxRef.current = fx
      return function () {
        fx.destroy()
        if (fxRef.current === fx) fxRef.current = null
      }
    },
    { dependencies: [scroller] }
  )

  useEffect(
    function () {
      return function () {
        fxRef.current = null
      }
    },
    []
  )

  return fxRef
}

export { useGalleryScroll }
