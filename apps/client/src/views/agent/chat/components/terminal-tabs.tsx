/**
 * 终端多 tab：标签栏 + 全部会话视图（非 active 仅 CSS 隐藏，切换不重建）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { clsx } from 'clsx'
import { toast } from 'sonner'

import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { useTerminalStore } from '@/stores/terminal'
import { TerminalView } from './terminal-view'

function TerminalTabs() {
  const tabs = useTerminalStore(function (state) {
    return state.tabs
  })
  const activeId = useTerminalStore(function (state) {
    return state.activeId
  })
  const { primaryPath } = useActiveWorkspace()

  function handleNewTab() {
    if (!primaryPath) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    useTerminalStore.getState().newTab(primaryPath)
  }

  function handleCloseTab(id: string) {
    useTerminalStore.getState().removeTab(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        {tabs.map(function (tab) {
          const active = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={clsx(
                'flex shrink-0 items-center gap-0.5 rounded-md',
                active ? 'bg-muted' : 'hover:bg-muted/60'
              )}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={clsx(
                  'h-6 justify-start gap-1.5 rounded-md px-2',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={function () {
                  useTerminalStore.getState().setActive(tab.id)
                }}>
                <span className="max-w-32 truncate">{tab.title}</span>
                {tab.exited ? <span className="opacity-60">已退出</span> : null}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭终端"
                title="关闭终端"
                className="text-muted-foreground hover:text-foreground size-5 shrink-0"
                onClick={function () {
                  handleCloseTab(tab.id)
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3"
                />
              </Button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="新建终端"
          title="新建终端"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={handleNewTab}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            暂无终端，点击 + 新建
          </div>
        ) : null}
        {tabs.map(function (tab) {
          return (
            <div
              key={tab.id}
              className={clsx('h-full w-full', tab.id !== activeId && 'hidden')}>
              <TerminalView
                id={tab.id}
                cwd={tab.cwd}
                active={tab.id === activeId}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { TerminalTabs }
