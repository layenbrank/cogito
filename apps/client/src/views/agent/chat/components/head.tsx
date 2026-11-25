/**
 * 中栏顶栏：只展示任务标题与运行态。
 * 会话列表 / 工作区开合在窗口操作栏，避免两处按钮说法不一致。
 */
import { useAuiState } from '@assistant-ui/react'
import { AgentStatus } from '@cogito/design/assistant/agent-status'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

const VIEWPORT_SLOT = '[data-slot="aui_thread-viewport"]'
const USER_MESSAGE_SLOT = '[data-user-message-id]'
/** 气泡仍在视口上半区时淡化标题，避免与用户句叠成双份 */
const TITLE_FADE_RATIO = 0.45

/**
 * 本轮跑了多久（`m:ss`）：`isActive` 为真时每秒 tick，转假就归零。
 *
 * 起始时刻存在 ref 里（不触发重渲染），只有格式化后的字符串进 state ——
 * 切换会话后组件不卸载，但 `isActive` 会转假，下一次运行重新计时。
 */
function useRunElapsed(isActive: boolean): string | undefined {
  const startedAtRef = useRef<number | null>(null)
  const [elapsed, updateElapsed] = useState<string | undefined>(undefined)

  useEffect(
    function () {
      if (!isActive) {
        startedAtRef.current = null
        updateElapsed(undefined)
        return
      }
      startedAtRef.current = startedAtRef.current ?? Date.now()
      function tick() {
        const startedAt = startedAtRef.current
        if (startedAt === null) return
        const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = String(totalSeconds % 60).padStart(2, '0')
        updateElapsed(`${minutes}:${seconds}`)
      }
      tick()
      const timer = window.setInterval(tick, 1000)
      return function () {
        window.clearInterval(timer)
      }
    },
    [isActive]
  )

  return elapsed
}

function AgentHead() {
  const headRef = useRef<HTMLElement>(null)
  const rafRef = useRef(0)
  const [isTitleSoft, updateTitleSoft] = useState(false)

  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  /** 正在等审批 / 补充信息：不是「跑」但也没结束，顶上必须能看出卡在哪 */
  const isWaiting = useAuiState(function (state) {
    const messages = state.thread.messages
    const last = messages[messages.length - 1]
    return last?.status?.type === 'requires-action'
  })
  const elapsed = useRunElapsed(isRunning || isWaiting)
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

  const displayTitle = title || '新会话'

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
        {isRunning || isWaiting ? (
          <AgentStatus
            state={isWaiting ? 'waiting' : 'working'}
            label={isWaiting ? '等待确认' : '生成中'}
            elapsed={elapsed}
            className="shrink-0"
          />
        ) : null}
      </div>
    </header>
  )
}

export { AgentHead }
