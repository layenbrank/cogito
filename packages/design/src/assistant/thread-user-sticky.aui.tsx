import { useAuiState } from '@assistant-ui/react'
import { cn } from 'cn'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react'

import { findScrollableAncestor } from './collapse-scroll-pin'
import { CHAT_EASE_CLASS, CHAT_ENTER } from './chat-motion'
import { useAssistantLabels } from './labels'
import {
  collectUserMessageMarks,
  scrollToUserMessage,
  type ThreadMessageLike,
  type UserMessageMark
} from './thread-user-ruler-marks'

const VIEWPORT_SHELL_SLOT = '[data-slot="aui_thread-viewport-shell"]'
const VIEWPORT_SLOT = '[data-slot="aui_thread-viewport"]'
/** 气泡底边越过视口顶多少 px 才视为「已滚出」，避免贴边闪烁 */
const PAST_TOP_PX = 12
/** 进退场位移（px）：少许下探，避免弹跳感 */
const STICKY_OFFSET_Y = 6

function findMarkElement(viewport: HTMLElement, id: string): HTMLElement | null {
  return viewport.querySelector<HTMLElement>(`[data-user-message-id="${CSS.escape(id)}"]`)
}

function isScrolledPastTop(viewport: HTMLElement, target: HTMLElement): boolean {
  const viewportTop = viewport.getBoundingClientRect().top
  return target.getBoundingClientRect().bottom < viewportTop + PAST_TOP_PX
}

/**
 * 该贴哪一条：从后往前找**第一条底边已越过视口顶**的用户消息。
 *
 * 以前只盯着最后一条 —— 回看历史时，中间那些被滚上去的提问永远贴不上来，
 * 于是「只有最后一条有 sticky」。现在按「读到这里，是从哪一句开始的」来选：
 * 越靠后且已折叠掉的，就是当前这段对话的开头。
 */
function findPinnedMark(
  viewport: HTMLElement,
  marks: readonly UserMessageMark[]
): UserMessageMark | null {
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index]
    if (!mark) continue
    const target = findMarkElement(viewport, mark.id)
    if (!target) continue
    if (isScrolledPastTop(viewport, target)) return mark
  }
  return null
}

/** 隐藏 sticky 前移走焦点，避免 aria-hidden/inert 祖先仍含 focused 后代 */
function blurFocusInside(host: HTMLElement | null) {
  if (!host) return
  const active = document.activeElement
  if (active instanceof HTMLElement && host.contains(active)) {
    active.blur()
  }
}

/**
 * Cursor 式用户句浓缩胶囊：**任意一条**用户气泡滚出视口顶后贴在 Viewport 顶，
 * 贴的是「当前正在读的这一段的开头」，不只是最后一句。
 */
const ThreadUserMessageSticky: FC = () => {
  const labels = useAssistantLabels()
  const prefersReducedMotion = useReducedMotion()
  const shellRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const rafRef = useRef(0)
  const [activeId, setActiveId] = useState('')
  const isPinned = activeId !== ''
  const isPinnedRef = useRef(isPinned)
  isPinnedRef.current = isPinned

  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  const marks = useMemo(
    function () {
      return collectUserMessageMarks(messages as readonly ThreadMessageLike[])
    },
    [messages]
  )

  /** marks 的签名：条数与最后一条 id 变了才需要重绑滚动监听 */
  const marksKey = marks.length === 0 ? '' : `${marks.length}:${marks[marks.length - 1]?.id ?? ''}`
  const activeMark =
    marks.find(function (mark) {
      return mark.id === activeId
    }) ?? null

  function commitActive(next: string) {
    if (isPinnedRef.current === (next !== '')) {
      // 已贴住时只换内容，不必重新走一遍进退场
      if (activeId !== next) setActiveId(next)
      return
    }
    // 先移走焦点，再提交隐藏态，避免 inert/aria-hidden 与 focused 后代冲突
    if (isPinnedRef.current && next === '') blurFocusInside(shellRef.current)
    isPinnedRef.current = next !== ''
    setActiveId(next)
  }

  function syncPinned() {
    const viewport = viewportRef.current
    if (!viewport || marks.length === 0) {
      commitActive('')
      return
    }
    const pinned = findPinnedMark(viewport, marks)
    commitActive(pinned?.id ?? '')
  }

  const syncPinnedRef = useRef(syncPinned)
  syncPinnedRef.current = syncPinned

  useLayoutEffect(
    function bindViewport() {
      const shell = shellRef.current
      if (!shell) return
      const host = shell.closest<HTMLElement>(VIEWPORT_SHELL_SLOT) ?? shell.parentElement
      const fromShell = host?.querySelector<HTMLElement>(VIEWPORT_SLOT)
      viewportRef.current = fromShell ?? (host ? findScrollableAncestor(host) : null)
    },
    [marksKey]
  )

  useLayoutEffect(
    function blurWhenUnpinned() {
      if (isPinned) return
      blurFocusInside(shellRef.current)
    },
    [isPinned]
  )

  useEffect(
    function bindScrollAndObserver() {
      if (marks.length === 0) {
        commitActive('')
        return
      }

      const viewport = viewportRef.current
      if (!viewport) return

      function onScrollOrResize() {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(function () {
          syncPinnedRef.current()
        })
      }

      onScrollOrResize()

      viewport.addEventListener('scroll', onScrollOrResize, { passive: true })
      window.addEventListener('resize', onScrollOrResize, { passive: true })

      // 每一条都要观察：滚到中途时贴的是「这一段的开头」，不是最后一条
      const observers: IntersectionObserver[] = []
      if (typeof IntersectionObserver !== 'undefined') {
        for (const mark of marks) {
          const target = findMarkElement(viewport, mark.id)
          if (!target) continue
          const observer = new IntersectionObserver(
            function () {
              onScrollOrResize()
            },
            { root: viewport, threshold: [0, 0.01, 1] }
          )
          observer.observe(target)
          observers.push(observer)
        }
      }

      return function () {
        cancelAnimationFrame(rafRef.current)
        viewport.removeEventListener('scroll', onScrollOrResize)
        window.removeEventListener('resize', onScrollOrResize)
        for (const observer of observers) observer.disconnect()
      }
    },
    // marksKey 足够：条数与最后一条变化时重绑，逐字变动不重绑
    [marks, marksKey]
  )

  if (!activeMark || !activeMark.preview) return null

  const { id: markId, preview, ordinal } = activeMark
  const total = marks.length

  function onActivate() {
    const viewport = viewportRef.current
    if (!viewport) return
    scrollToUserMessage(viewport, markId, prefersReducedMotion)
  }

  const pinnedMotion = prefersReducedMotion
    ? { opacity: isPinned ? 1 : 0, y: 0 }
    : isPinned
      ? { opacity: 1, y: 0 }
      : { opacity: 0, y: -STICKY_OFFSET_Y }

  return (
    <motion.div
      ref={shellRef}
      data-slot="aui_thread-user-sticky"
      data-pinned={isPinned || undefined}
      data-user-message-sticky-id={activeId || undefined}
      // 隐藏态用 inert（而非仅 aria-hidden），避免 focused 后代触发浏览器拦截警告
      inert={isPinned ? undefined : true}
      initial={false}
      animate={pinnedMotion}
      transition={CHAT_ENTER}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-2.5 sm:px-4">
      <button
        type="button"
        tabIndex={isPinned ? 0 : -1}
        aria-label={labels.userMessageSticky}
        title={labels.userMessageSticky}
        disabled={!isPinned}
        className={cn(
          'group pointer-events-auto inline-flex h-8 max-w-[min(100%,28rem)] items-center gap-2',
          'rounded-full border border-border/45 bg-background/75 px-3.5',
          'text-foreground shadow-[0_8px_18px_-14px_color-mix(in_oklab,var(--foreground)_24%,transparent)]',
          'backdrop-blur-md supports-backdrop-filter:bg-background/55',
          'text-left outline-none',
          'transition-[background-color,border-color,box-shadow] duration-150',
          CHAT_EASE_CLASS,
          'motion-reduce:transition-none',
          'hover:border-border/65 hover:bg-background/88',
          'hover:shadow-[0_10px_20px_-14px_color-mix(in_oklab,var(--foreground)_30%,transparent)]',
          'active:border-border/70 active:bg-background/95',
          'focus-visible:ring-ring/40 focus-visible:ring-2',
          'disabled:pointer-events-none'
        )}
        onClick={onActivate}>
        <span
          aria-hidden
          className={cn(
            'bg-muted-foreground/60 size-1.5 shrink-0 rounded-full',
            'transition-[background-color,opacity] duration-150',
            CHAT_EASE_CLASS,
            'motion-reduce:transition-none',
            'group-hover:bg-muted-foreground group-active:bg-foreground/70'
          )}
        />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-muted-foreground shrink-0 text-xs leading-none font-medium tracking-wide tabular-nums">
            {ordinal}/{total}
          </span>
          <span
            aria-hidden
            className="bg-border/70 h-3 w-px shrink-0"
          />
          <span className="text-foreground/90 min-w-0 truncate text-sm leading-none tracking-tight">
            {preview}
          </span>
        </span>
      </button>
    </motion.div>
  )
}

export { ThreadUserMessageSticky }
