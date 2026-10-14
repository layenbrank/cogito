import { useEffect, useRef, useState } from 'react'

import { NEAR_VIEWPORT_MARGIN } from '@/views/gallery/constraints'

/** 进入近视口后置 true 并断开观察（用于延后绑定媒体 src） */
function useNearViewport<T extends HTMLElement = HTMLElement>(
  rootMargin: string = NEAR_VIEWPORT_MARGIN
) {
  const ref = useRef<T | null>(null)
  const [isNear, onNear] = useState(false)

  useEffect(
    function () {
      if (isNear) return
      const node = ref.current
      if (!node || typeof IntersectionObserver === 'undefined') {
        onNear(true)
        return
      }

      const observer = new IntersectionObserver(
        function (entries) {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              onNear(true)
              observer.disconnect()
              return
            }
          }
        },
        { root: null, rootMargin, threshold: 0.01 }
      )
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    [isNear, rootMargin]
  )

  return { ref, isNear }
}

export { useNearViewport }
