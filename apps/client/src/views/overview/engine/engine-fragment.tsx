/**
 * 搜索建议下拉列表：Motion 入场 + GSAP 指示条 / 键盘滚动对齐
 */
import { clsx } from 'clsx'
import * as m from 'motion/react-m'
import { Icon } from '@iconify/react/offline'
import { useEffect, useRef } from 'react'

import {
  bindOverviewScroll,
  bindIndicatorDriver,
  SCROLL_DURATION,
  type OverviewScrollSession,
  type IndicatorDriver
} from '@/lib/overview-scroll'
import { ENGINE_UI } from '@/views/overview/engine/engine-constants'
import { parseSuggestionLabel } from '@/views/overview/engine/engine-url'
import styles from '@/views/overview/overview.module.scss'

interface EngineFragmentProps {
  series: Engine.Item[]
  navigation: number
  onSelect: (item: Engine.Item) => void
  onNavigate: (index: number) => void
}

/** 将活动项滚入可视区（首尾贴边） */
function findItemScrollTop(
  container: HTMLElement,
  item: HTMLElement,
  index: number,
  total: number,
  viewTop: number
) {
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
  if (total <= 0) return viewTop

  if (index <= 0) return 0
  if (index >= total - 1) return maxScroll

  const viewBottom = viewTop + container.clientHeight
  const itemTop = item.offsetTop
  const itemBottom = itemTop + item.offsetHeight
  const pad = ENGINE_UI.SCROLL_PAD

  if (itemBottom > viewBottom - pad) {
    return Math.min(maxScroll, itemBottom - container.clientHeight + pad)
  }
  if (itemTop < viewTop + pad) {
    return Math.max(0, itemTop - pad)
  }
  return viewTop
}

function EngineFragment(props: EngineFragmentProps) {
  const { series, navigation, onSelect, onNavigate } = props
  const fragmentRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const sessionRef = useRef<OverviewScrollSession | null>(null)
  const indicatorDriverRef = useRef<IndicatorDriver | null>(null)
  const scrollTarget = useRef(0)
  const isFirstPaint = useRef(true)
  const skipScroll = useRef(false)
  // 键盘滚动时列表在光标下移动会触发 mouseenter，需暂时忽略指针选中
  const isPointerNavLocked = useRef(false)
  const pointerUnlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const seriesKey = series
    .map(function (item) {
      return item.id
    })
    .join('|')
  const boundKey = useRef('')

  function unlockPointerNav() {
    if (pointerUnlockTimer.current) {
      clearTimeout(pointerUnlockTimer.current)
      pointerUnlockTimer.current = null
    }
    isPointerNavLocked.current = false
  }

  function lockPointerNav(durationMs: number) {
    isPointerNavLocked.current = true
    if (pointerUnlockTimer.current) {
      clearTimeout(pointerUnlockTimer.current)
    }
    pointerUnlockTimer.current = setTimeout(function () {
      isPointerNavLocked.current = false
      pointerUnlockTimer.current = null
    }, durationMs)
  }

  function ensureIndicatorDriver() {
    const indicator = indicatorRef.current
    if (!indicator) return null
    if (!indicatorDriverRef.current) {
      indicatorDriverRef.current = bindIndicatorDriver(indicator)
    }
    return indicatorDriverRef.current
  }

  function bindScrollSession() {
    const el = fragmentRef.current
    if (!el) return
    if (boundKey.current === seriesKey && sessionRef.current) return

    boundKey.current = seriesKey
    itemRefs.current = itemRefs.current.slice(0, series.length)
    const items = itemRefs.current.filter(Boolean) as HTMLDivElement[]
    sessionRef.current?.destroy()
    sessionRef.current = bindOverviewScroll(el, items, {
      onScrollTarget(value) {
        scrollTarget.current = value
      }
    })

    const driver = ensureIndicatorDriver()
    if (!driver) return
    if (navigation < 0) {
      driver.hide()
      return
    }
    const active = itemRefs.current[navigation]
    if (active) {
      driver.sync(active, true)
    }
  }

  useEffect(
    function () {
      isFirstPaint.current = true
      boundKey.current = ''
      scrollTarget.current = fragmentRef.current?.scrollTop ?? 0
      unlockPointerNav()
      indicatorDriverRef.current?.destroy()
      indicatorDriverRef.current = null

      return function () {
        unlockPointerNav()
        sessionRef.current?.destroy()
        sessionRef.current = null
        indicatorDriverRef.current?.destroy()
        indicatorDriverRef.current = null
        boundKey.current = ''
      }
    },
    [seriesKey]
  )

  useEffect(
    function () {
      const container = fragmentRef.current
      const driver = ensureIndicatorDriver()
      if (!container || !driver) return

      if (navigation < 0) {
        driver.hide()
        return
      }

      const active = itemRefs.current[navigation]
      if (!active) return

      const instant = isFirstPaint.current
      isFirstPaint.current = false
      driver.sync(active, instant)

      if (skipScroll.current) {
        skipScroll.current = false
        return
      }

      const viewTop = scrollTarget.current
      const next = findItemScrollTop(container, active, navigation, series.length, viewTop)

      if (Math.abs(next - viewTop) < 0.5) return

      scrollTarget.current = next
      const durationMs = Math.round(SCROLL_DURATION * 1000) + 40
      lockPointerNav(durationMs)
      sessionRef.current?.scrollTo(next, {
        duration: SCROLL_DURATION,
        onComplete: unlockPointerNav
      })
    },
    [navigation, seriesKey, series.length]
  )

  return (
    <m.div
      ref={fragmentRef}
      initial={{
        opacity: 0,
        y: -6,
        clipPath: 'inset(0 0 10% 0)'
      }}
      animate={{
        opacity: 1,
        y: 0,
        clipPath: 'inset(0 0 0% 0)'
      }}
      exit={{
        opacity: 0,
        y: -4,
        clipPath: 'inset(0 0 8% 0)'
      }}
      transition={{
        duration: 0.3,
        ease: [0.22, 1, 0.36, 1]
      }}
      className={clsx(styles.engine, styles.fragment)}
      role="listbox">
      <m.div
        key={seriesKey}
        className={clsx(styles.engine, styles.fragmentTrack)}
        variants={ENGINE_UI.LIST_VARIANTS}
        initial="hidden"
        animate="show"
        onAnimationComplete={bindScrollSession}>
        <div
          ref={indicatorRef}
          className={clsx(styles.engine, styles.fragmentIndicator)}
          aria-hidden
        />
        {series.map(function (item, index) {
          const isActive = navigation === index
          return (
            <m.div
              key={item.id}
              variants={ENGINE_UI.ITEM_VARIANTS}
              ref={function (node) {
                itemRefs.current[index] = node
              }}
              role="option"
              aria-selected={isActive}
              className={clsx(styles.engine, styles.fragmentValue, {
                [styles.fragmentActive]: isActive
              })}
              onMouseEnter={function () {
                if (isPointerNavLocked.current) return
                if (index === navigation) return
                skipScroll.current = true
                onNavigate(index)
              }}
              onMouseDown={function (e) {
                e.preventDefault()
              }}
              onClick={function (e) {
                e.stopPropagation()
                onSelect(item)
              }}>
              <span>{parseSuggestionLabel(item.q)}</span>
              <Icon
                icon="mdi:arrow-right"
                className={clsx(styles.engine, styles.fragmentMark, {
                  [styles.fragmentMarkActive]: isActive
                })}
              />
            </m.div>
          )
        })}
      </m.div>
    </m.div>
  )
}

export { EngineFragment }
export type { EngineFragmentProps }
