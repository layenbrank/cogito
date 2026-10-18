import { useEffect, useRef, type RefObject } from 'react'

import { cursorInMain, stackPage } from '@/views/navigation/ipc'
import {
  findCoveringLayer,
  findShownLayer,
  LAYER_QUERY,
  LAYER_TRIGGER_QUERY,
  type Rect
} from '@/views/overview/browser/cover'

interface PageStack {
  /** 搜索建议出现或收起。两边都会重新对齐层级。 */
  holdSuggest: (suggest: Rect | null) => void
  /** 网页刚被摆过位置后，按当前浮层再摆一次层级。 */
  reapply: () => void
}

function usePageStack<T extends HTMLElement>(pageRef: RefObject<T | null>, enabled: boolean): PageStack {
  const suggestRef = useRef(false)
  const aboveRef = useRef(true)
  const latchRef = useRef(false)
  const sawLayerRef = useRef(false)
  const ticketRef = useRef(0)
  const chainRef = useRef(Promise.resolve())
  const coveredRef = useRef(function (_suggesting: boolean) {
    return false
  })
  const syncRef = useRef(function (_above: boolean, _force?: boolean) {})

  function pageRect(): Rect | null {
    const node = pageRef.current
    if (!node) return null
    const box = node.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  function covered(suggesting: boolean) {
    if (suggesting) return true
    if (findCoveringLayer(pageRect())) {
      sawLayerRef.current = true
      return true
    }
    if (latchRef.current && !sawLayerRef.current) return true
    latchRef.current = false
    sawLayerRef.current = false
    return false
  }

  function sync(above: boolean, force = false) {
    if (!force && aboveRef.current === above) return
    aboveRef.current = above
    const ticket = ticketRef.current + 1
    ticketRef.current = ticket
    const run = chainRef.current.then(function () {
      if (ticket !== ticketRef.current) return
      return stackPage(above).catch(function (error: unknown) {
        console.error('[browser] 调整网页层级失败', error)
      })
    })
    chainRef.current = run.then(
      function () {},
      function () {}
    )
  }

  function align(force: boolean) {
    const isCovered = covered(suggestRef.current)
    sync(!isCovered, force || isCovered)
  }

  function holdSuggest(suggest: Rect | null) {
    suggestRef.current = suggest !== null
    align(suggest !== null)
  }

  function reapply() {
    align(true)
  }

  useEffect(function () {
    coveredRef.current = covered
    syncRef.current = sync
  })

  useEffect(function () {
    function holdTrigger(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest(LAYER_TRIGGER_QUERY)) return
      if (findShownLayer()) return
      latchRef.current = true
      sawLayerRef.current = false
      syncRef.current(false, true)
    }
    function onPointerOut(event: PointerEvent) {
      if (sawLayerRef.current) return
      const target = event.target
      if (!(target instanceof Element) || !target.closest(LAYER_TRIGGER_QUERY)) return
      const next = event.relatedTarget
      if (next instanceof Element && (next.closest(LAYER_TRIGGER_QUERY) || next.closest(LAYER_QUERY))) {
        return
      }
      latchRef.current = false
      const isCovered = coveredRef.current(suggestRef.current)
      syncRef.current(!isCovered, isCovered)
    }
    document.addEventListener('pointerdown', holdTrigger, true)
    document.addEventListener('pointerover', holdTrigger, true)
    document.addEventListener('pointerout', onPointerOut, true)
    return function () {
      document.removeEventListener('pointerdown', holdTrigger, true)
      document.removeEventListener('pointerover', holdTrigger, true)
      document.removeEventListener('pointerout', onPointerOut, true)
    }
  }, [])

  useEffect(function () {
    if (!enabled) return
    let stopped = false
    const timer = window.setInterval(function () {
      void cursorInMain()
        .then(function (point) {
          if (stopped || !point) return
          const isCovered = coveredRef.current(suggestRef.current)
          syncRef.current(!isCovered, isCovered)
        })
        .catch(function () {})
    }, 80)
    return function () {
      stopped = true
      window.clearInterval(timer)
    }
  }, [enabled])

  useEffect(function () {
    function syncLayer() {
      const isCovered = coveredRef.current(suggestRef.current)
      syncRef.current(!isCovered, isCovered)
    }
    syncLayer()
    const observer = new MutationObserver(syncLayer)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-open', 'data-closed', 'data-layer']
    })
    return function () {
      observer.disconnect()
    }
  }, [])

  return { holdSuggest, reapply }
}

export { usePageStack }
export type { PageStack }
