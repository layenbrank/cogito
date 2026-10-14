/**
 * 终端面板容器：标题栏（标题 + 关闭）+ 多 tab 内容。
 *
 * 固定在右栏（aside），不提供位置切换。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'

import { useTerminalStore } from '@/stores/terminal'
import { TerminalTabs } from './terminal-tabs'

function TerminalPanel() {
  const closePanel = useTerminalStore(function (state) {
    return state.closePanel
  })

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <Icon
          icon="lucide:terminal"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-muted-foreground truncate text-xs font-medium">终端</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭终端面板"
            title="关闭终端面板"
            className="text-muted-foreground hover:text-foreground size-6"
            onClick={closePanel}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
      <TerminalTabs />
    </div>
  )
}

export { TerminalPanel }
