import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Button } from '@i-thinking/design/components/button'
interface HeadProps {
  isSidebarOpen: boolean
  isAsideOpen: boolean
  onToggleSidebar: () => void
  onToggleAside: () => void
}

/**
 * 中栏顶栏：对齐 client / Qoder 的紧凑标题条（约 40px）。
 */
export default function AgentHead(props: HeadProps) {
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const title = useAuiState(function (state) {
    const item = state.threads.threadItems.find(function (entry) {
      return entry.id === state.threads.mainThreadId
    })
    return item?.title ?? ''
  })

  return (
    <header className="border-border bg-background flex h-10 shrink-0 items-center gap-2 border-b px-2.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-slot="agent-sidebar-toggle"
        aria-label={props.isSidebarOpen ? '隐藏左侧栏' : '显示左侧栏'}
        title={`${props.isSidebarOpen ? '隐藏' : '显示'}左侧栏`}
        className={
          props.isSidebarOpen
            ? 'text-muted-foreground hover:text-foreground size-8 rounded-lg'
            : 'text-foreground bg-muted size-8 rounded-lg'
        }
        onClick={props.onToggleSidebar}>
        <Icon icon="lucide:panel-left" className="size-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden
          data-running={isRunning ? 'true' : 'false'}
          className="bg-muted-foreground data-[running=true]:bg-success size-1.5 shrink-0 rounded-full"
        />
        <span className="text-sm truncate font-medium">{title || '新任务'}</span>
        {isRunning ? (
          <span className="text-muted-foreground shrink-0 text-xs">生成中…</span>
        ) : null}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-slot="agent-aside-toggle"
        aria-label={props.isAsideOpen ? '隐藏右侧栏' : '显示右侧栏'}
        title={`${props.isAsideOpen ? '隐藏' : '显示'}右侧栏`}
        className={
          props.isAsideOpen
            ? 'text-foreground bg-muted size-8 rounded-lg'
            : 'text-muted-foreground hover:text-foreground size-8 rounded-lg'
        }
        onClick={props.onToggleAside}>
        <Icon icon="lucide:panel-right" className="size-4" />
      </Button>
    </header>
  )
}
