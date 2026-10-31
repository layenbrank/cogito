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

function findLatestUserMark(messages: readonly ThreadMessageLike[]): {
  mark: UserMessageMark
  total: number
} | null {
  const marks = collectUserMessageMarks(messages)
  if (marks.length === 0) return null
  const mark = marks[marks.length - 1]
  if (!mark) return null
  return { mark, total: marks.length }
}

function isScrolledPastTop(viewport: HTMLElement, target: HTMLElement): boolean {
  const viewportTop = viewport.getBoundingClientRect().top
  return target.getBoundingClientRect().bottom < viewportTop + PAST_TOP_PX
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
 * Cursor 式用户句浓缩胶囊：仅最新用户气泡滚出视口顶后贴在 Viewport 顶，
 * 避免与仍在视野内的气泡标题叠成双份。
 */
const ThreadUserMessageSticky: FC = () => {
  const labels = useAssistantLabels()
  const prefersReducedMotion = useReducedMotion()
  const shellRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const rafRef = useRef(0)
  const [isPinned, setPinned] = useState(false)
  const isPinnedRef = useRef(isPinned)
  isPinnedRef.current = isPinned

  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  const latest = useMemo(
    function () {
      return findLatestUserMark(messages as readonly ThreadMessageLike[])
    },
    [messages]
  )

  const latestId = latest?.mark.id ?? ''
  const preview = latest?.mark.preview ?? ''
  const ordinal = latest?.mark.ordinal ?? 0
  const total = latest?.total ?? 0

  function commitPinned(next: boolean) {
    if (isPinnedRef.current === next) return
    // 先移走焦点，再提交隐藏态，避免 inert/aria-hidden 与 focused 后代冲突
    if (isPinnedRef.current && !next) blurFocusInside(shellRef.current)
    isPinnedRef.current = next
    setPinned(next)
  }

  function syncPinned() {
    const viewport = viewportRef.current
    if (!viewport || !latestId) {
      commitPinned(false)
      return
    }
    const target = viewport.querySelector<HTMLElement>(
      `[data-user-message-id="${CSS.escape(latestId)}"]`
    )
    if (!target) {
      commitPinned(false)
      return
    }
    commitPinned(isScrolledPastTop(viewport, target))
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
    [latestId]
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
      if (!latestId) {
        commitPinned(false)
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

      const target = viewport.querySelector<HTMLElement>(
        `[data-user-message-id="${CSS.escape(latestId)}"]`
      )
      let observer: IntersectionObserver | null = null
      if (target && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          function () {
            onScrollOrResize()
          },
          { root: viewport, threshold: [0, 0.01, 1] }
        )
        observer.observe(target)
      }

      return function () {
        cancelAnimationFrame(rafRef.current)
        viewport.removeEventListener('scroll', onScrollOrResize)
        window.removeEventListener('resize', onScrollOrResize)
        observer?.disconnect()
      }
    },
    [latestId]
  )

  if (!latest || !preview) return null

  function onActivate() {
    const viewport = viewportRef.current
    if (!viewport) return
    scrollToUserMessage(viewport, latestId, prefersReducedMotion)
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
