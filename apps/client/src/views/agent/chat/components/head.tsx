import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'

interface HeadProps {
  isSidebarOpen: boolean
  isAsideOpen: boolean
  onToggleSidebar: () => void
  onToggleAside: () => void
}

/**
 * 中栏顶栏：左/右各一枚 panel 切换（唯一收缩入口）+ 会话标题。
 * 开=常态弱色；关=浅底高亮，提示可点开。
 */
function AgentHead(props: HeadProps) {
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const title = useAuiState(function (state) {
    const item = state.threads.threadItems.find(function (entry) {
      return entry.id === state.threads.mainThreadId
    })
    return item?.title ?? ''
  })

  function toggleClass(isOpen: boolean) {
    return clsx(
      'size-8 rounded-lg',
      isOpen
        ? 'text-muted-foreground hover:text-foreground'
        : 'bg-muted text-foreground'
    )
  }

  return (
    <header className="border-border bg-background flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
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
          className="bg-muted-foreground data-[running=true]:bg-success size-1.5 shrink-0 rounded-full"
        />
        <span className="truncate text-sm font-medium">{title || '新任务'}</span>
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
