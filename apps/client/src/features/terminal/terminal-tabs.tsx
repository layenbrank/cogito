/**
 * 交互 PTY 多 tab（右栏终端面板 / 底部 Dock 共用）。
 *
 * **只挂载当前 active 的 TerminalView**：在 opacity-0 / 非 terminal 页签下预挂
 * xterm 会 fit 出空画布，切回来不重绘 → agent 终端白屏只剩光标。
 * 切 tab / 显示面板时再 mount → attach 回放 Rust scrollback（内容在 PTY 侧，不丢）。
 *
 * `activeId` 失效时回落第一个 tab，避免「有 tab 却无视图」。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { toast } from 'sonner'

import { Terminal } from '@/lib/terminal'
import { useTerminalStore } from '@/stores/terminal'

import { TerminalView } from './terminal-view'

interface TerminalTabsProps {
  cwd?: string | null
  emptyCwdMessage?: string
  /**
   * 宿主面板是否真正可见（右栏 mode===terminal）。
   * false 时不挂 xterm，避免在透明覆盖层里 fit 出空白画布。
   */
  paneVisible?: boolean
}

function TerminalTabs(props: TerminalTabsProps) {
  const tabs = useTerminalStore(function (state) {
    return state.tabs
  })
  const storeActiveId = useTerminalStore(function (state) {
    return state.activeId
  })
  const emptyCwdMessage = props.emptyCwdMessage ?? '请先设置工作目录'
  const paneVisible = props.paneVisible !== false
  /** activeId 失效时回落第一个：绝不让「有 tab 但一个都不 active」把面板渲染成空白 */
  const activeId =
    storeActiveId && tabs.some(function (tab) {
      return tab.id === storeActiveId
    })
      ? storeActiveId
      : (tabs[0]?.id ?? null)
  const activeTab = tabs.find(function (tab) {
    return tab.id === activeId
  })

  function handleNewTab() {
    if (!props.cwd) {
      toast.error(emptyCwdMessage)
      return
    }
    useTerminalStore.getState().newTab(props.cwd, { reveal: false })
  }

  function handleCloseTab(id: string) {
    // 关 UI tab 同时杀 Rust 会话，否则刷新后 list 仍能看到孤儿 PTY
    void Terminal.kill(id).catch(function (error) {
      console.warn('[terminal] kill 失败:', id, error)
    })
    useTerminalStore.getState().removeTab(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        {tabs.map(function (tab) {
          const active = tab.id === activeId
          const isAgent = tab.origin === 'agent'
          return (
            <div
              key={tab.id}
              className={clsx(
                'flex shrink-0 items-center gap-0.5 rounded-md border border-transparent',
                active ? 'bg-muted border-border/60' : 'hover:bg-muted/60'
              )}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                title={`${tab.title}${isAgent ? '（agent 会话）' : ''}\n${tab.cwd}`}
                className={clsx(
                  'h-6 justify-start gap-1.5 rounded-md px-2',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={function () {
                  useTerminalStore.getState().writeActive(tab.id)
                }}>
                <Icon
                  icon={isAgent ? 'lucide:bot' : 'lucide:terminal'}
                  className={clsx('size-3 shrink-0', isAgent && 'text-primary')}
                />
                <span className="max-w-32 truncate">{tab.title}</span>
                {tab.restored && !tab.exited ? (
                  <Icon
                    icon="lucide:history"
                    className="size-3 shrink-0 opacity-60"
                    aria-label="恢复的会话"
                  />
                ) : null}
                {tab.exited ? (
                  <span className="text-muted-foreground/80 text-[10px]">已退出</span>
                ) : null}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭"
                title="关闭这个终端"
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
          title="新建交互终端"
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
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Icon
              icon="lucide:terminal"
              className="text-muted-foreground/50 size-7"
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              还没有终端会话
              <br />
              点右上角 <span className="text-foreground font-medium">+</span>{' '}
              新建一个，agent 跑命令时也会自动出现在这里
            </p>
          </div>
        ) : null}
        {paneVisible && activeTab ? (
          <div
            key={activeTab.id}
            className="absolute inset-0 z-10">
            <TerminalView
              id={activeTab.id}
              cwd={activeTab.cwd}
              active
              origin={activeTab.origin}
              restored={activeTab.restored}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { TerminalTabs }
export type { TerminalTabsProps }
