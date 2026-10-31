import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

interface HeadProps {
  isSidebarOpen: boolean
  isAsideOpen: boolean
  onToggleSidebar: () => void
  onToggleAside: () => void
}

const VIEWPORT_SLOT = '[data-slot="aui_thread-viewport"]'
const USER_MESSAGE_SLOT = '[data-user-message-id]'
/** 气泡仍在视口上半区时淡化标题，避免与用户句叠成双份 */
const TITLE_FADE_RATIO = 0.45

/**
 * 中栏顶栏：左/右各一枚 panel 切换（唯一收缩入口）+ 会话标题。
 * 开=常态弱色；关=浅底高亮，提示可点开。
 * 用户气泡仍在视口上方时淡化标题；滚走后由 Thread 浓缩 sticky 承接对照。
 */
function AgentHead(props: HeadProps) {
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
          const inUpperBand =
            rect.bottom > viewportRect.top + 4 && rect.top < fadeBottom
          if (inUpperBand) soft = true
        }
        // 最新句已滚出 → Thread 浓缩 sticky 接手，顶栏标题让位避免再叠一份
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

  function toggleClass(isOpen: boolean) {
    return clsx(
      'size-8 rounded-lg',
      isOpen ? 'text-muted-foreground hover:text-foreground' : 'bg-muted text-foreground'
    )
  }

  const displayTitle = title || '新任务'

  return (
    <header
      ref={headRef}
      className={clsx(
        'border-border/50 bg-background/90 relative z-30 flex h-10 shrink-0 items-center gap-1.5 border-b px-2',
        'shadow-[0_8px_18px_-16px_color-mix(in_oklab,var(--foreground)_22%,transparent)]',
        'backdrop-blur-md supports-backdrop-filter:bg-background/78'
      )}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-region="false"
              data-slot="agent-sidebar-toggle"
              aria-label={props.isSidebarOpen ? '隐藏左侧栏' : '显示左侧栏'}
              aria-pressed={props.isSidebarOpen}
              className={toggleClass(props.isSidebarOpen)}
              onClick={props.onToggleSidebar}
            />
          }>
          <Icon
            icon="lucide:panel-left"
            className="size-4"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {props.isSidebarOpen ? '隐藏左侧栏' : '显示左侧栏'}
        </TooltipContent>
      </Tooltip>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <span
          aria-hidden
          data-running={isRunning ? 'true' : 'false'}
          className="bg-muted-foreground/70 data-[running=true]:bg-success data-[running=true]:shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_25%,transparent)] size-1.5 shrink-0 rounded-full transition-shadow"
        />
        <span
          title={displayTitle}
          data-soft={isTitleSoft ? 'true' : 'false'}
          className={clsx(
            'truncate text-sm font-medium tracking-tight transition-[opacity,color] duration-200',
            'ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            isTitleSoft
              ? 'text-muted-foreground/45 opacity-40'
              : 'text-foreground opacity-100'
          )}>
          {displayTitle}
        </span>
        {isRunning ? (
          <span className="text-muted-foreground shrink-0 text-xs">生成中…</span>
        ) : null}
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-region="false"
              data-slot="agent-aside-toggle"
              aria-label={props.isAsideOpen ? '隐藏右侧栏' : '显示右侧栏'}
              aria-pressed={props.isAsideOpen}
              className={toggleClass(props.isAsideOpen)}
              onClick={props.onToggleAside}
            />
          }>
          <Icon
            icon="lucide:panel-right"
            className="size-4"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {props.isAsideOpen ? '隐藏右侧栏' : '显示右侧栏'}
        </TooltipContent>
      </Tooltip>
    </header>
  )
}

export { AgentHead }
export type { HeadProps }
