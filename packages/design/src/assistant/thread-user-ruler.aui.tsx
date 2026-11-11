import { useAuiState } from '@assistant-ui/react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react'

import { ConversationMap, type ConversationMapTurn } from './conversation-map'
import { findScrollableAncestor } from './collapse-scroll-pin'
import { useAssistantLabels } from './labels'
import {
  collectUserMessageMarks,
  scrollToUserMessage,
  type ThreadMessageLike
} from './thread-user-ruler-marks'

const VIEWPORT_ANCHOR_RATIO = 0.22
const VIEWPORT_SHELL_SLOT = '[data-slot="aui_thread-viewport-shell"]'
const VIEWPORT_SLOT = '[data-slot="aui_thread-viewport"]'

interface RulerProbe {
  /** 正在读的那一根的下标（没算出来就一直是 0） */
  index: number
  /** 落在视口里的那些 id（顺序即消息顺序） */
  visible: string[]
}

function isNewChatView(s: {
  thread: { messages: readonly unknown[]; isLoading: boolean }
  threads: { isLoading: boolean }
}) {
  return s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading)
}

function isHistoryLoadingView(s: {
  thread: { messages: readonly unknown[]; isLoading: boolean; isDisabled: boolean }
  threads: { isLoading: boolean }
}) {
  return (
    s.thread.messages.length === 0 &&
    s.thread.isLoading &&
    !s.thread.isDisabled &&
    !s.threads.isLoading
  )
}

function findMarkElement(viewport: HTMLElement, id: string) {
  return viewport.querySelector<HTMLElement>(`[data-user-message-id="${CSS.escape(id)}"]`)
}

/**
 * 一次扫描同时算两件事：
 * - `visible`：整条消息落在这个视口里的那些（元素把它们画深一档）；
 * - `index`：离「阅读锚」（视口顶下 22%）最近的那一根 —— 都没有在视口里时，
 *   退化成「最后一根已经滚过锚点之上的」，再退化成第一条。
 */
function scanMarks(viewport: HTMLElement, markIds: readonly string[]): RulerProbe {
  const viewportRect = viewport.getBoundingClientRect()
  const anchorY = viewportRect.top + viewportRect.height * VIEWPORT_ANCHOR_RATIO
  const visible: string[] = []
  let activeIndex = -1
  let bestDistance = Infinity

  for (let index = 0; index < markIds.length; index += 1) {
    const id = markIds[index]
    const element = findMarkElement(viewport, id)
    if (!element) continue

    const rect = element.getBoundingClientRect()
    if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) continue
    visible.push(id)

    const centerY = rect.top + rect.height / 2
    const distance = Math.abs(centerY - anchorY)
    if (distance < bestDistance) {
      bestDistance = distance
      activeIndex = index
    }
  }

  if (activeIndex >= 0) return { index: activeIndex, visible }

  for (let index = markIds.length - 1; index >= 0; index -= 1) {
    const element = findMarkElement(viewport, markIds[index])
    if (!element) continue
    if (element.getBoundingClientRect().top <= anchorY) return { index, visible }
  }

  return { index: 0, visible }
}

function isSameProbe(a: RulerProbe, b: RulerProbe) {
  if (a.index !== b.index) return false
  if (a.visible.length !== b.visible.length) return false
  for (let index = 0; index < a.visible.length; index += 1) {
    if (a.visible[index] !== b.visible[index]) return false
  }
  return true
}

/**
 * 会话左侧的回合刻度尺（assistant-ui `elements/conversation-map`）。
 *
 * 这个文件只管「算」：哪些刻度在视口里、正在读哪一根、点了跳哪儿；
 * 长什么样全部交给 `conversation-map` 元素，样式与状态口径都写在那儿。
 */
const ThreadUserMessageRuler: FC = () => {
  const labels = useAssistantLabels()
  const prefersReducedMotion = useReducedMotion()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const markIdsRef = useRef<readonly string[]>([])
  const rafRef = useRef(0)
  const [probe, setProbe] = useState<RulerProbe>({ index: 0, visible: [] })

  const visible = useAuiState(function (state) {
    if (isNewChatView(state)) return false
    if (isHistoryLoadingView(state)) return false
    return state.thread.messages.some(function (message) {
      return message.role === 'user'
    })
  })

  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  const marks = useMemo(
    function () {
      return collectUserMessageMarks(messages as readonly ThreadMessageLike[])
    },
    [messages]
  )

  const markIds = useMemo(
    function () {
      return marks.map(function (mark) {
        return mark.id
      })
    },
    [marks]
  )

  const markIdsKey = useMemo(
    function () {
      return markIds.join('\u0000')
    },
    [markIds]
  )

  markIdsRef.current = markIds

  const syncProbe = useCallback(function () {
    const viewport = viewportRef.current
    const ids = markIdsRef.current
    if (!viewport || ids.length === 0) return

    const next = scanMarks(viewport, ids)
    setProbe(function (prev) {
      return isSameProbe(prev, next) ? prev : next
    })
  }, [])

  const syncProbeRef = useRef(syncProbe)
  syncProbeRef.current = syncProbe

  useLayoutEffect(
    function bindViewport() {
      const host = hostRef.current
      if (!host) return
      const shell = host.closest<HTMLElement>(VIEWPORT_SHELL_SLOT)
      const fromShell = shell?.querySelector<HTMLElement>(VIEWPORT_SLOT)
      viewportRef.current = fromShell ?? findScrollableAncestor(host)
    },
    [visible, markIdsKey]
  )

  useEffect(
    function bindScroll() {
      if (!visible) return
      const viewport = viewportRef.current
      if (!viewport) return

      function onScrollOrResize() {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(function () {
          syncProbeRef.current()
        })
      }

      onScrollOrResize()

      viewport.addEventListener('scroll', onScrollOrResize, { passive: true })
      window.addEventListener('resize', onScrollOrResize, { passive: true })

      return function () {
        cancelAnimationFrame(rafRef.current)
        viewport.removeEventListener('scroll', onScrollOrResize)
        window.removeEventListener('resize', onScrollOrResize)
      }
    },
    [visible, markIdsKey]
  )

  useEffect(
    function syncAfterMessagesPaint() {
      if (!visible) return
      let innerFrame = 0
      const outerFrame = requestAnimationFrame(function () {
        innerFrame = requestAnimationFrame(function () {
          syncProbeRef.current()
        })
      })
      return function () {
        cancelAnimationFrame(outerFrame)
        cancelAnimationFrame(innerFrame)
      }
    },
    [visible, markIdsKey]
  )

  if (!visible || marks.length === 0) return null

  const total = marks.length
  // 消息变少时旧下标会越界：比较处收敛即可，不必用 effect 再追一遍
  const activeIndex = Math.min(probe.index, total - 1)
  const turns: ConversationMapTurn[] = marks.map(function (mark) {
    return {
      id: mark.id,
      label: labels.userMessageLocatorItem(mark.ordinal, total),
      preview: mark.preview
    }
  })

  function onSelect(messageId: string) {
    const viewport = viewportRef.current
    if (!viewport) return
    scrollToUserMessage(viewport, messageId, prefersReducedMotion)
  }

  return (
    <div
      ref={hostRef}
      data-slot="aui_thread-user-ruler"
      // 尺子只占左侧那条窄沟：不参与布局、不挡正文点击（刻度自己是 pointer-events-auto）
      className="pointer-events-none absolute inset-y-0 start-0 z-30 flex items-center max-sm:hidden">
      <ConversationMap
        turns={turns}
        activeId={marks[activeIndex]?.id ?? null}
        visibleIds={probe.visible}
        onSelect={onSelect}
      />
    </div>
  )
}

export { ThreadUserMessageRuler }
