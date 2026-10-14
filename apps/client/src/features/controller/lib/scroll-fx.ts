/**
 * Mirror 滚动阻尼
 *
 * 仿 ScrollSmoother 的「长尾追赶」——Observer 拦 wheel，累积 target，
 * 再用 gsap.quickTo(scrollTop, expo.out ~1.25s) 缓到目标。
 * 不用 ScrollSmoother 本体（会 position:fixed，嵌套 Mirror 会毁布局）。
 *
 * 磁贴入场由 MagneticTile.Enter + Motion 拥有，本模块不写 surface。
 */
import gsap from 'gsap'
import { Observer } from 'gsap/Observer'

import { findReducedMotion } from '@/features/window/appearance'

gsap.registerPlugin(Observer)

/** 实体磁贴（排除 Suspense 骨架）——Sortable ghost 清理用 */
const TILE_SELECTOR = '.magnetic-tile:not(.magnetic-tile-skeleton)'
const SURFACE_SELECTOR = '.magnetic-tile-surface'

/**
 * 追赶时长 / 缓动：对齐 ScrollSmoother 默认 `smooth≈0.8` + ease expo。
 * 短 lerp（~0.25s）肉眼接近原生；要「丝滑」必须把尾巴拉长到 1s+。
 */
const SMOOTH_DURATION = 1.25
const SMOOTH_EASE = 'expo.out'

interface ScrollFxOptions {
  /** 阻尼追赶时长（秒） */
  duration?: number
  ease?: string
}

type ScrollFx = {
  pause(): void
  resume(): void
  /** 停阻尼并滚回顶部（切页用） */
  reset(): void
  /** 平滑滚到指定 scrollTop（与阻尼共用 quickTo） */
  scrollToY(y: number, duration?: number): void
  destroy(): void
}

/** scroller → 存活实例，供 resetMirrorScroll 停掉阻尼 */
const ACTIVE = new WeakMap<HTMLElement, ScrollFx>()

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function findSurface(tile: HTMLElement): HTMLElement {
  return (tile.querySelector(SURFACE_SELECTOR)) ?? tile
}

/** 拖拽 ghost：只杀残留 gsap，不 clearProps（避免抹掉 Motion surface） */
function clearGhost(ghost: HTMLElement | null) {
  if (!ghost) return
  const surface = findSurface(ghost)
  gsap.killTweensOf(ghost)
  gsap.killTweensOf(surface)
}

function prefersReducedMotion() {
  return findReducedMotion()
}

function findScrollMax(scroller: HTMLElement) {
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight)
}

function bindScrollFx(scroller: HTMLElement, options?: ScrollFxOptions): ScrollFx {
  ACTIVE.get(scroller)?.destroy()

  let isDragging = false
  const canMotion = !prefersReducedMotion()
  const duration = options?.duration ?? SMOOTH_DURATION
  const ease = options?.ease ?? SMOOTH_EASE

  let target = scroller.scrollTop
  let observer: Observer | null = null

  const quickScroll = canMotion
    ? gsap.quickTo(scroller, 'scrollTop', {
        duration,
        ease
      })
    : null

  function stopDamp() {
    gsap.killTweensOf(scroller)
  }

  function syncFromDom() {
    target = scroller.scrollTop
  }

  function nudgeBy(delta: number) {
    const max = findScrollMax(scroller)
    if (max <= 0 || !quickScroll) return false

    // 未在补间时对齐（例如刚拖过滚动条）
    if (!gsap.isTweening(scroller)) syncFromDom()

    target = clamp(target + delta, 0, max)
    quickScroll(target)
    return true
  }

  function onScroll() {
    if (isDragging || gsap.isTweening(scroller)) return
    syncFromDom()
  }

  if (canMotion) {
    observer = Observer.create({
      target: scroller,
      type: 'wheel',
      preventDefault: true,
      onChangeY(self) {
        if (isDragging) return
        nudgeBy(self.deltaY)
      }
    })
    scroller.addEventListener('scroll', onScroll, { passive: true })
  }

  const fx: ScrollFx = {
    pause() {
      if (isDragging) return
      isDragging = true
      stopDamp()
      syncFromDom()
      observer?.disable()
    },
    resume() {
      if (!isDragging) return
      isDragging = false
      syncFromDom()
      observer?.enable()
    },
    reset() {
      stopDamp()
      scroller.scrollTop = 0
      target = 0
    },
    scrollToY(y, jumpDuration) {
      const max = findScrollMax(scroller)
      target = clamp(y, 0, max)
      if (!canMotion || !quickScroll) {
        scroller.scrollTop = target
        return
      }
      if (jumpDuration !== undefined) {
        stopDamp()
        gsap.to(scroller, {
          scrollTop: target,
          duration: jumpDuration,
          ease: 'power2.out',
          overwrite: true
        })
        return
      }
      quickScroll(target)
    },
    destroy() {
      isDragging = true
      stopDamp()
      ACTIVE.delete(scroller)
      observer?.kill()
      observer = null
      scroller.removeEventListener('scroll', onScroll)
    }
  }

  ACTIVE.set(scroller, fx)
  return fx
}

/** 切页归零滚动（停掉阻尼） */
function resetMirrorScroll(scroller: HTMLElement | null) {
  if (!scroller) return
  const fx = ACTIVE.get(scroller)
  if (fx) {
    fx.reset()
    return
  }
  scroller.scrollTop = 0
}

export { bindScrollFx, clearGhost, resetMirrorScroll, TILE_SELECTOR }
export type { ScrollFx, ScrollFxOptions }
