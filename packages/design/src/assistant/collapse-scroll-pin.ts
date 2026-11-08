/**
 * 对话贴底折叠：高度只能往上收时，面板先瞬间收起，用等高 spacer 顶住总高，
 * 再把 spacer 平滑收到 0，避免 Viewport followBottom 跟高度动画抢滚动。
 */
import { type RefObject, useCallback, useEffect, useRef } from 'react'

import { CHAT_DURATION_MS, CHAT_EASE } from './chat-motion'

const NEAR_BOTTOM_PX = 96
const PIN_TAIL_MS = 48

function findScrollableAncestor(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

function isNearBottom(scroll: HTMLElement, threshold = NEAR_BOTTOM_PX): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= threshold
}

function findCollapsePanel(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>('[data-slot="collapsible-content"]') ??
    root.querySelector<HTMLElement>('[data-slot="reasoning-content"]') ??
    root.querySelector<HTMLElement>('[data-slot="tool-group-content"]') ??
    root.querySelector<HTMLElement>('[data-slot="tool-fallback-content"]')
  )
}

function measurePanelHeight(panel: HTMLElement): number {
  const rect = panel.getBoundingClientRect()
  const style = getComputedStyle(panel)
  const margin = Number.parseFloat(style.marginTop) + Number.parseFloat(style.marginBottom)
  return Math.max(0, Math.round(rect.height + margin))
}

function forcePanelShut(panel: HTMLElement) {
  panel.style.setProperty('transition', 'none', 'important')
  panel.style.setProperty('height', '0px', 'important')
  panel.style.setProperty('min-height', '0px', 'important')
  panel.style.setProperty('overflow', 'hidden', 'important')
}

function releasePanel(panel: HTMLElement) {
  panel.style.removeProperty('transition')
  panel.style.removeProperty('height')
  panel.style.removeProperty('min-height')
  panel.style.removeProperty('overflow')
}

/** 贴底时 spacer 高度变化不会触发 assistant-ui 的 subtree MO，用 rAF 跟住 scrollHeight */
function beginScrollHeightPin(scroll: HTMLElement, durationMs: number): () => void {
  let lastScrollHeight = scroll.scrollHeight
  let frameId = 0
  const endAt = performance.now() + durationMs + PIN_TAIL_MS

  function tick() {
    const nextScrollHeight = scroll.scrollHeight
    if (nextScrollHeight !== lastScrollHeight) {
      scroll.scrollTop += nextScrollHeight - lastScrollHeight
      lastScrollHeight = nextScrollHeight
    }
    if (performance.now() < endAt) {
      frameId = requestAnimationFrame(tick)
    }
  }

  frameId = requestAnimationFrame(tick)
  return function () {
    cancelAnimationFrame(frameId)
  }
}

/**
 * 贴底收起时、在 setOpen(false) **之前**调用。
 * 非贴底 no-op。返回是否已接管（调用方可跳过自身高度动画时长逻辑）。
 */
function useCollapseScrollPin(rootRef: RefObject<HTMLElement | null>) {
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef(0)
  const endPinRef = useRef<(() => void) | null>(null)
  const forcedPanelRef = useRef<HTMLElement | null>(null)

  useEffect(function () {
    return function () {
      window.clearTimeout(timerRef.current)
      timerRef.current = 0
      endPinRef.current?.()
      endPinRef.current = null
      if (forcedPanelRef.current) {
        releasePanel(forcedPanelRef.current)
        forcedPanelRef.current = null
      }
      spacerRef.current?.remove()
      spacerRef.current = null
    }
  }, [])

  const armPin = useCallback(
    (durationMs: number = CHAT_DURATION_MS): boolean => {
      const root = rootRef.current
      if (!root) return false

      const scroll = findScrollableAncestor(root)
      if (!scroll || !isNearBottom(scroll)) return false

      const panel = findCollapsePanel(root)
      const panelHeight = panel ? measurePanelHeight(panel) : 0
      if (panelHeight < 1) return false

      spacerRef.current?.remove()
      window.clearTimeout(timerRef.current)
      endPinRef.current?.()
      endPinRef.current = null
      if (forcedPanelRef.current) {
        releasePanel(forcedPanelRef.current)
        forcedPanelRef.current = null
      }

      if (panel) {
        forcePanelShut(panel)
        forcedPanelRef.current = panel
      }

      const spacer = document.createElement('div')
      spacer.setAttribute('data-slot', 'collapse-scroll-spacer')
      spacer.setAttribute('aria-hidden', 'true')
      spacer.style.cssText = [
        `height:${panelHeight}px`,
        'margin:0',
        'padding:0',
        'border:0',
        'pointer-events:none',
        'flex-shrink:0',
        'overflow:hidden',
        'overflow-anchor:none',
        durationMs > 0
          ? `transition:height ${durationMs}ms cubic-bezier(${CHAT_EASE.join(',')})`
          : 'transition:none'
      ].join(';')

      // 放在 root 内、与面板同级，并在本帧把面板压到 0，总高不变，避免 followBottom 看到尖峰
      root.appendChild(spacer)
      spacerRef.current = spacer

      endPinRef.current = beginScrollHeightPin(scroll, durationMs)

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (spacerRef.current !== spacer) return
          spacer.style.height = '0px'

          const clear = function () {
            endPinRef.current?.()
            endPinRef.current = null
            spacer.remove()
            if (spacerRef.current === spacer) spacerRef.current = null
            if (forcedPanelRef.current === panel && panel) {
              releasePanel(panel)
              forcedPanelRef.current = null
            }
          }

          if (durationMs <= 0) {
            clear()
            return
          }

          function onTransitionEnd(event: TransitionEvent) {
            if (event.target !== spacer || event.propertyName !== 'height') return
            spacer.removeEventListener('transitionend', onTransitionEnd)
            clear()
          }
          spacer.addEventListener('transitionend', onTransitionEnd)
          timerRef.current = window.setTimeout(function () {
            spacer.removeEventListener('transitionend', onTransitionEnd)
            clear()
          }, durationMs + PIN_TAIL_MS)
        })
      })

      return true
    },
    [rootRef]
  )

  return armPin
}

export { useCollapseScrollPin, findScrollableAncestor, isNearBottom }
