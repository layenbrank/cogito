/**
 * Overview 搜索列表滚动
 *
 * - 滚轮走原生滚动（避免 Observer + tween 跟手延迟）
 * - 键盘 / 程序定位用 GSAP scrollTo 平滑对齐
 * - 高亮指示条用 quickTo 跟手
 */
import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'

import { findReducedMotion } from '@/features/window/appearance'

let isRegistered = false

const INDICATOR_DURATION = 0.2
const SCROLL_DURATION = 0.28

function ensurePlugins() {
  if (isRegistered) return
  gsap.registerPlugin(ScrollToPlugin)
  isRegistered = true
}

function hasReducedMotion() {
  return findReducedMotion()
}

function clampScrollTop(container: HTMLElement, scrollTop: number) {
  const max = Math.max(0, container.scrollHeight - container.clientHeight)
  return Math.max(0, Math.min(scrollTop, max))
}

type ScrollToOptions = {
  duration?: number
  onComplete?: () => void
}

type OverviewScrollSession = {
  scrollTo: (scrollTop: number, options?: number | ScrollToOptions) => void
  refresh: () => void
  destroy: () => void
}

type BindOverviewScrollOptions = {
  onScrollTarget?: (scrollTop: number) => void
}

type IndicatorDriver = {
  sync: (item: HTMLElement, instant?: boolean) => void
  hide: () => void
  destroy: () => void
}

/** 高亮条与行对齐：quickTo 跟手 */
function bindIndicatorDriver(indicator: HTMLElement): IndicatorDriver {
  ensurePlugins()

  const moveY = gsap.quickTo(indicator, 'y', {
    duration: INDICATOR_DURATION,
    ease: 'power2.out'
  })
  const moveH = gsap.quickTo(indicator, 'height', {
    duration: INDICATOR_DURATION,
    ease: 'power2.out'
  })

  function sync(item: HTMLElement, instant = false) {
    const y = item.offsetTop
    const height = item.offsetHeight

    gsap.set(indicator, { opacity: 1 })

    if (instant || hasReducedMotion()) {
      gsap.set(indicator, { y, height })
      return
    }

    moveY(y)
    moveH(height)
  }

  function hide() {
    gsap.set(indicator, { opacity: 0 })
  }

  return {
    sync,
    hide,
    destroy() {
      gsap.killTweensOf(indicator)
    }
  }
}

/**
 * 绑定列表滚动：滚轮原生；键盘/程序定位用 scrollTo
 * 入场 stagger 由 Motion 负责，滚动中不做 opacity fromTo
 */
function bindOverviewScroll(
  container: HTMLElement,
  items: HTMLElement[],
  options: BindOverviewScrollOptions = {}
): OverviewScrollSession {
  ensurePlugins()

  function syncScrollTarget() {
    options.onScrollTarget?.(container.scrollTop)
  }

  function scrollTo(scrollTop: number, optionsOrDuration?: number | ScrollToOptions) {
    const parsed =
      typeof optionsOrDuration === 'number'
        ? { duration: optionsOrDuration }
        : (optionsOrDuration ?? {})
    const duration = parsed.duration ?? SCROLL_DURATION
    const onComplete = parsed.onComplete
    const next = clampScrollTop(container, scrollTop)
    options.onScrollTarget?.(next)

    if (hasReducedMotion()) {
      gsap.killTweensOf(container)
      container.scrollTop = next
      onComplete?.()
      return
    }

    gsap.to(container, {
      scrollTo: { y: next, autoKill: true },
      duration,
      ease: 'power2.out',
      overwrite: 'auto',
      onComplete: onComplete
    })
  }

  container.addEventListener('scroll', syncScrollTarget, { passive: true })

  items.forEach(function (item) {
    gsap.set(item, { clearProps: 'opacity' })
  })

  return {
    scrollTo,
    refresh() {
      items.forEach(function (item) {
        gsap.set(item, { clearProps: 'opacity' })
      })
    },
    destroy() {
      container.removeEventListener('scroll', syncScrollTarget)
      gsap.killTweensOf(container)
      items.forEach(function (item) {
        gsap.killTweensOf(item)
        gsap.set(item, { clearProps: 'opacity' })
      })
    }
  }
}

export {
  ensurePlugins,
  hasReducedMotion,
  clampScrollTop,
  bindOverviewScroll,
  bindIndicatorDriver,
  INDICATOR_DURATION,
  SCROLL_DURATION
}

export type { OverviewScrollSession, IndicatorDriver }
