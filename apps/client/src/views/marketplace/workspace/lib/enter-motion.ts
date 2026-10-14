import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { findReducedMotion } from '@/features/window/appearance'

const CARD_ATTR = 'data-list-card'
const CARD_SELECTOR = `[${CARD_ATTR}]`

const ENTER_Y = 28
const ENTER_DURATION = 0.45
/** 向下：卡顶进入 scroller 约 85% 再播（gsap-skills） */
const BATCH_START = 'top 85%'
/**
 * leave：卡底越过 scroller 顶 = 完全离开上方。
 * 不用 top top：彼时卡仍在视口内，与「仅出屏 hide」叠加会导致 played 不清、向上无动效。
 */
const BATCH_END = 'bottom top'
/** 与 BATCH_START 同义：卡顶相对 scroller 高度的进场比例 */
const ENTER_LINE_RATIO = 0.85
const BATCH_INTERVAL = 0.08
const BATCH_MAX = 8
const STUCK_OPACITY = 0.5
const CLEAR_ENTER_PROPS = 'y,opacity,visibility'

gsap.registerPlugin(ScrollTrigger)

type EnterFrom = 'below' | 'above'

type EnterMotion = {
  destroy(): void
}

type BindEnterMotionOptions = {
  selector?: string
}

function findCards(scroller: Element, selector: string) {
  return gsap.utils.toArray<HTMLElement>(selector, scroller)
}

function isCardInScroller(card: HTMLElement, scroller: Element) {
  const cardRect = card.getBoundingClientRect()
  const rootRect = scroller.getBoundingClientRect()
  return cardRect.top < rootRect.bottom && cardRect.bottom > rootRect.top
}

function isFullyAbove(card: HTMLElement, scroller: Element) {
  return card.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top
}

/** 等价 start: top 85% —— 卡顶已越过进场线 */
function isPastEnterLine(card: HTMLElement, scroller: Element) {
  const cardRect = card.getBoundingClientRect()
  const rootRect = scroller.getBoundingClientRect()
  const enterY = rootRect.top + rootRect.height * ENTER_LINE_RATIO
  return cardRect.top <= enterY
}

/** 卡主要落在 scroller 上半区（向上进场漏触判定） */
function isMostlyInUpperHalf(card: HTMLElement, scroller: Element) {
  const cardRect = card.getBoundingClientRect()
  const rootRect = scroller.getBoundingClientRect()
  const midY = rootRect.top + rootRect.height * 0.5
  return cardRect.bottom < midY
}

function findEnterY(from: EnterFrom) {
  return from === 'below' ? ENTER_Y : -ENTER_Y
}

/**
 * marketplace 列表进场（booth / navigate）：
 * - start top 85% / end bottom top；refresh 前清 y
 * - 仅出屏才 hide / 清 played；上下漏触窄范围兜底
 */
function bindEnterMotion(scroller: Element, options?: BindEnterMotionOptions): EnterMotion {
  const selector = options?.selector ?? CARD_SELECTOR
  const cards = findCards(scroller, selector)
  const played = new WeakSet<HTMLElement>()
  const triggers: ScrollTrigger[] = []
  const cleanups: Array<() => void> = []

  function hideCards(batch: HTMLElement[], readyFrom: EnterFrom) {
    if (batch.length === 0) return
    for (const card of batch) played.delete(card)
    gsap.set(batch, {
      autoAlpha: 0,
      y: findEnterY(readyFrom),
      overwrite: true
    })
  }

  function showCardsInstant(batch: HTMLElement[]) {
    if (batch.length === 0) return
    for (const card of batch) played.add(card)
    gsap.set(batch, {
      autoAlpha: 1,
      y: 0,
      overwrite: true,
      clearProps: CLEAR_ENTER_PROPS
    })
  }

  function playEnter(batch: HTMLElement[], from: EnterFrom) {
    const next = batch.filter(function (card) {
      if (played.has(card)) return false
      played.add(card)
      return true
    })
    if (next.length === 0) return

    for (const card of next) {
      const opacity = Number(gsap.getProperty(card, 'opacity'))
      const fromAlpha = opacity < STUCK_OPACITY ? 0 : opacity
      gsap.fromTo(
        card,
        { autoAlpha: fromAlpha, y: findEnterY(from) },
        {
          autoAlpha: 1,
          y: 0,
          duration: ENTER_DURATION,
          ease: 'power2.out',
          overwrite: true,
          clearProps: CLEAR_ENTER_PROPS
        }
      )
    }
  }

  /** 仅真正出屏才清 played + hide；视口内 leave 不重播 */
  function onLeaveZone(batch: HTMLElement[], readyFrom: EnterFrom) {
    const outside = batch.filter(function (card) {
      return !isCardInScroller(card, scroller)
    })
    if (outside.length === 0) return
    hideCards(outside, readyFrom)
  }

  /**
   * 快滚漏触兜底（窄范围，禁止任意相交 hard show）：
   * - 已过向下进场线 → playEnter below
   * - 上半区出现、未过向下进场线 → playEnter above
   */
  function revealStuckCards() {
    const stuckBelow: HTMLElement[] = []
    const stuckAbove: HTMLElement[] = []
    for (const card of cards) {
      if (!isCardInScroller(card, scroller)) continue
      if (gsap.isTweening(card)) continue
      if (played.has(card)) continue
      const opacity = Number(gsap.getProperty(card, 'opacity'))
      if (opacity >= STUCK_OPACITY) continue

      if (isPastEnterLine(card, scroller)) {
        stuckBelow.push(card)
      } else if (isMostlyInUpperHalf(card, scroller)) {
        stuckAbove.push(card)
      }
    }
    if (stuckBelow.length > 0) playEnter(stuckBelow, 'below')
    if (stuckAbove.length > 0) playEnter(stuckAbove, 'above')
  }

  if (findReducedMotion()) {
    showCardsInstant(cards)
  } else {
    const ready: HTMLElement[] = []
    const above: HTMLElement[] = []
    const below: HTMLElement[] = []
    for (const card of cards) {
      if (isPastEnterLine(card, scroller) && isCardInScroller(card, scroller)) {
        ready.push(card)
      } else if (isFullyAbove(card, scroller)) {
        above.push(card)
      } else {
        below.push(card)
      }
    }

    hideCards(above, 'above')
    hideCards(below, 'below')

    const batchTriggers = ScrollTrigger.batch(cards, {
      scroller,
      start: BATCH_START,
      end: BATCH_END,
      interval: BATCH_INTERVAL,
      batchMax: BATCH_MAX,
      /** 官方：refresh 前临时清 y，避免 transform 打乱 start/end */
      onRefreshInit() {
        return gsap.set(cards, { y: 0 })
      },
      onEnter(batch) {
        playEnter(batch as HTMLElement[], 'below')
      },
      onEnterBack(batch) {
        playEnter(batch as HTMLElement[], 'above')
      },
      onLeave(batch) {
        onLeaveZone(batch as HTMLElement[], 'above')
      },
      onLeaveBack(batch) {
        onLeaveZone(batch as HTMLElement[], 'below')
      }
    })
    triggers.push(...batchTriggers)

    playEnter(ready, 'below')

    scroller.addEventListener('scroll', revealStuckCards, { passive: true })
    const revealFrame = window.requestAnimationFrame(revealStuckCards)
    cleanups.push(function () {
      window.cancelAnimationFrame(revealFrame)
      scroller.removeEventListener('scroll', revealStuckCards)
    })
  }

  return {
    destroy() {
      for (const cleanup of cleanups) cleanup()
      for (const trigger of triggers) trigger.kill()
    }
  }
}

/** ScrollTrigger 重建键：bucket + query + 可见 id 集合（排序后，与展示顺序无关） */
function findMotionKey(bucket: string, query: string, tiles: Array<{ id: string }>) {
  const ids = tiles
    .map(function (tile) {
      return tile.id
    })
    .sort()
    .join(',')
  return `${bucket}:${query.trim()}:${ids}`
}

/** 布局刷新键：展示顺序变化时仅 refresh，不拆掉进场绑定 */
function findLayoutKey(tiles: Array<{ id: string }>) {
  return tiles
    .map(function (tile) {
      return tile.id
    })
    .join(',')
}

export { CARD_ATTR, CARD_SELECTOR, bindEnterMotion, findLayoutKey, findMotionKey }
export type { BindEnterMotionOptions, EnterMotion }
