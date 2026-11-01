/**
 * 中栏顶栏：只展示任务标题与运行态。
 * 会话列表 / 工作区开合在窗口操作栏，避免两处按钮说法不一致。
 */
import { useAuiState } from '@assistant-ui/react'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

const VIEWPORT_SLOT = '[data-slot="aui_thread-viewport"]'
const USER_MESSAGE_SLOT = '[data-user-message-id]'
/** 气泡仍在视口上半区时淡化标题，避免与用户句叠成双份 */
const TITLE_FADE_RATIO = 0.45

function AgentHead() {
  const headRef = useRef<HTMLElement>(null)
  const rafRef = useRef(0)
  const [isTitleSoft, updateTitleSoft] = useState(false)

  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const title = useAuiState(function (state) {
    const item = state.threads.threadItems.find(function (entry) {
      return entry.id === state.threads.mainThreadId
    })
    return item?.title ?? ''
  })
  const hasUserMessage = useAuiState(function (state) {
    return state.thread.messages.some(function (message) {
      return message.role === 'user'
    })
  })

  useEffect(
    function syncTitleSoft() {
      if (!hasUserMessage) {
        updateTitleSoft(false)
        return
      }

      const host = headRef.current?.parentElement
      const viewport = host?.querySelector<HTMLElement>(VIEWPORT_SLOT)
      if (!viewport) return

      function measure() {
        const scroll = viewport
        if (!scroll) return

        const userMessages = scroll.querySelectorAll<HTMLElement>(USER_MESSAGE_SLOT)
        if (userMessages.length === 0) {
          updateTitleSoft(false)
          return
        }

        const viewportRect = scroll.getBoundingClientRect()
        const fadeBottom = viewportRect.top + viewportRect.height * TITLE_FADE_RATIO
        let soft = false
        let latest: HTMLElement | null = null
        for (const node of userMessages) {
          latest = node
          const rect = node.getBoundingClientRect()
          const inUpperBand = rect.bottom > viewportRect.top + 4 && rect.top < fadeBottom
          if (inUpperBand) soft = true
        }
        if (latest && latest.getBoundingClientRect().bottom < viewportRect.top + 12) {
          soft = true
        }
        updateTitleSoft(function (prev) {
          return prev === soft ? prev : soft
        })
      }

      function onScrollOrResize() {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(measure)
      }

      measure()
      viewport.addEventListener('scroll', onScrollOrResize, { passive: true })
      window.addEventListener('resize', onScrollOrResize, { passive: true })

      return function () {
        cancelAnimationFrame(rafRef.current)
        viewport.removeEventListener('scroll', onScrollOrResize)
        window.removeEventListener('resize', onScrollOrResize)
      }
    },
    [hasUserMessage, title]
  )

  const displayTitle = title || '新任务'

  return (
    <header
      ref={headRef}
      className={clsx(
        'border-border/50 bg-background/90 relative z-30 flex h-10 shrink-0 items-center gap-1.5 border-b px-3',
        'shadow-[0_8px_18px_-16px_color-mix(in_oklab,var(--foreground)_22%,transparent)]',
        'backdrop-blur-md supports-backdrop-filter:bg-background/78'
      )}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden
          data-running={isRunning ? 'true' : 'false'}
          className="bg-foreground/55 data-[running=true]:bg-success data-[running=true]:shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_25%,transparent)] size-1.5 shrink-0 rounded-full transition-shadow"
        />
        <span
          title={displayTitle}
          data-soft={isTitleSoft ? 'true' : 'false'}
          className={clsx(
            'truncate text-sm font-semibold tracking-tight transition-colors duration-200',
            'ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            // 与用户气泡重叠时略降对比，但仍保持可读；勿叠 opacity
            isTitleSoft ? 'text-foreground/70' : 'text-foreground'
          )}>
          {displayTitle}
        </span>
        {isRunning ? (
          <span className="text-muted-foreground shrink-0 text-xs">生成中…</span>
        ) : null}
      </div>
    </header>
  )
}

export { AgentHead }
