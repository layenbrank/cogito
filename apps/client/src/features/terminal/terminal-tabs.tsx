/**
 * 终端多 tab：标签栏 + 会话视图。
 *
 * 非 active 用 `invisible`（保留布局尺寸），禁止 `hidden`/`display:none`——
 * 否则 xterm FitAddon 量到 0 列，切换/新建后画面错乱。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { clsx } from 'clsx'
import { toast } from 'sonner'

import { TerminalView } from '@/features/terminal/terminal-view'
import { useTerminalStore } from '@/stores/terminal'

interface TerminalTabsProps {
  /** 新建终端时的工作目录；缺省时提示用户 */
  cwd?: string | null
  /** cwd 不可用时的错误提示 */
  emptyCwdMessage?: string
}

function TerminalTabs(props: TerminalTabsProps) {
  const tabs = useTerminalStore(function (state) {
    return state.tabs
  })
  const activeId = useTerminalStore(function (state) {
    return state.activeId
  })
  const emptyCwdMessage = props.emptyCwdMessage ?? '请先设置工作目录'

  function handleNewTab() {
    if (!props.cwd) {
      toast.error(emptyCwdMessage)
      return
    }
    useTerminalStore.getState().newTab(props.cwd, { reveal: false })
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
                onClick={function (event) {
                  event.stopPropagation()
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
          const active = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={clsx(
                'absolute inset-0',
                active ? 'z-10' : 'invisible pointer-events-none z-0'
              )}
              aria-hidden={!active}>
              <TerminalView
                id={tab.id}
                cwd={tab.cwd}
                active={active}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { TerminalTabs }
export type { TerminalTabsProps }
