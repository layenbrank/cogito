import { useAuiState } from '@assistant-ui/react'
import { cn } from 'cn'
import { useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip'
import { findScrollableAncestor } from './collapse-scroll-pin'
import { useAssistantLabels } from './labels'
import {
  collectUserMessageMarks,
  scrollToUserMessage,
  type ThreadMessageLike
} from './thread-user-ruler-marks'

const VIEWPORT_ANCHOR_RATIO = 0.22
const GUTTER_WIDTH_PX = 32
/** 刻度间距：紧凑簇，勿按会话全高均分铺开 */
const MARK_GAP_PX = 10
const VIEWPORT_SHELL_SLOT = '[data-slot="aui_thread-viewport-shell"]'
const VIEWPORT_SLOT = '[data-slot="aui_thread-viewport"]'

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

function findActiveMarkIndex(viewport: HTMLElement, markIds: readonly string[]): number {
  if (markIds.length === 0) return -1

  const viewportRect = viewport.getBoundingClientRect()
  const anchorY = viewportRect.top + viewportRect.height * VIEWPORT_ANCHOR_RATIO

  let activeIndex = -1
  let bestDistance = Infinity

  for (let index = 0; index < markIds.length; index += 1) {
    const id = markIds[index]
    const element = viewport.querySelector<HTMLElement>(
      `[data-user-message-id="${CSS.escape(id)}"]`
    )
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const inView = rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
    if (!inView) continue

    const centerY = rect.top + rect.height / 2
    const distance = Math.abs(centerY - anchorY)
    if (distance < bestDistance) {
      bestDistance = distance
      activeIndex = index
    }
  }

  if (activeIndex >= 0) return activeIndex

  for (let index = markIds.length - 1; index >= 0; index -= 1) {
    const id = markIds[index]
    const element = viewport.querySelector<HTMLElement>(
      `[data-user-message-id="${CSS.escape(id)}"]`
    )
    if (!element) continue
    if (element.getBoundingClientRect().top <= anchorY) return index
  }

  return 0
}

const ThreadUserMessageRuler: FC = () => {
  const labels = useAssistantLabels()
  const prefersReducedMotion = useReducedMotion()
  const trackRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const markIdsRef = useRef<readonly string[]>([])
  const rafRef = useRef(0)
  const [activeIndex, setActiveIndex] = useState(0)

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

  function syncActiveMark() {
    const viewport = viewportRef.current
    const ids = markIdsRef.current
    if (!viewport || ids.length === 0) return

    const next = findActiveMarkIndex(viewport, ids)
    if (next < 0) return
    setActiveIndex(function (prev) {
      return prev === next ? prev : next
    })
  }

  const syncActiveMarkRef = useRef(syncActiveMark)
  syncActiveMarkRef.current = syncActiveMark

  useLayoutEffect(
    function bindViewport() {
      const track = trackRef.current
      if (!track) return
      const shell = track.closest<HTMLElement>(VIEWPORT_SHELL_SLOT)
      const fromShell = shell?.querySelector<HTMLElement>(VIEWPORT_SLOT)
      viewportRef.current = fromShell ?? findScrollableAncestor(track)
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
          syncActiveMarkRef.current()
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
    function syncActiveAfterMessagesPaint() {
      if (!visible) return
      let innerFrame = 0
      const outerFrame = requestAnimationFrame(function () {
        innerFrame = requestAnimationFrame(function () {
          syncActiveMarkRef.current()
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
  // 消息条数变少时旧下标会越界：比较处收敛即可，不必用 effect 再 setState 追一遍
  const activeMarkIndex = Math.min(activeIndex, total - 1)

  function onMarkClick(messageId: string) {
    const viewport = viewportRef.current
    if (!viewport) return
    scrollToUserMessage(viewport, messageId, prefersReducedMotion)
  }

  return (
    <TooltipProvider delay={200}>
      <nav
        ref={trackRef}
        data-slot="aui_thread-user-ruler"
        aria-label={labels.userMessageLocator}
        style={{ width: GUTTER_WIDTH_PX }}
        className="pointer-events-none absolute inset-y-0 start-0 z-30 flex items-center justify-center overflow-visible">
        {/* 刻度簇垂直居中、固定间距，避免按全高均分显得过散；过多时簇内滚动 */}
        <div
          className="relative flex max-h-[min(70vh,22rem)] w-full flex-col items-stretch overflow-y-auto overscroll-y-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ gap: MARK_GAP_PX }}>
          <div
            aria-hidden
            className="bg-border/50 absolute inset-y-1 start-[11px] w-px"
          />
          {marks.map(function (mark, index) {
            const isActive = index === activeMarkIndex

            return (
              <Tooltip key={mark.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-slot="aui_thread-user-ruler-mark"
                      data-active={isActive || undefined}
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={labels.userMessageLocatorItem(mark.ordinal, total)}
                      className={cn(
                        'group pointer-events-auto relative flex h-3.5 w-full shrink-0 items-center justify-start',
                        'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                      )}
                      onClick={function () {
                        onMarkClick(mark.id)
                      }}>
                      <span
                        aria-hidden
                        className="relative flex h-full w-full items-center">
                        <span
                          className={cn(
                            'absolute start-[9px] size-[5px] rotate-45 rounded-[1px]',
                            'transition-[background-color,box-shadow,transform] duration-150 ease-out',
                            'motion-reduce:transition-none',
                            isActive
                              ? 'bg-foreground/75 scale-100'
                              : 'bg-foreground/25 scale-[0.85] group-hover:bg-foreground/45 group-hover:scale-100'
                          )}
                        />
                        <span
                          className={cn(
                            'absolute start-[15px] h-px rounded-full',
                            'transition-[width,opacity,background-color] duration-150 ease-out',
                            'motion-reduce:transition-none',
                            isActive
                              ? 'bg-foreground/55 w-3 opacity-100'
                              : 'bg-foreground/30 w-2 opacity-0 group-hover:opacity-70'
                          )}
                        />
                      </span>
                    </button>
                  }
                />
                <TooltipContent
                  side="right"
                  align="center"
                  sideOffset={8}
                  showArrow={false}
                  className={cn(
                    // 短预览时 rounded-2xl 会显胶囊；用中等圆角 + 最小宽度更利落
                    'border-border/50 bg-popover text-popover-foreground',
                    'flex min-w-[11rem] max-w-[16rem] flex-col items-start gap-1 rounded-md border px-3 py-2',
                    'text-left shadow-sm ring-1 ring-foreground/4'
                  )}>
                  <span className="text-muted-foreground text-xs leading-none font-medium tracking-wide tabular-nums">
                    {labels.userMessageLocatorItem(mark.ordinal, total)}
                  </span>
                  <span className="text-foreground/90 line-clamp-3 text-xs leading-snug tracking-tight">
                    {mark.preview}
                  </span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </nav>
    </TooltipProvider>
  )
}

export { ThreadUserMessageRuler }
