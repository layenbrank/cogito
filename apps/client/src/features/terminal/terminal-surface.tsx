/**
 * 终端面板容器：标题栏（会话数 + 同步会话 + 新开 + 全部关闭）+ 多 tab 内容。
 *
 * 「同步会话」是刷新 / 重开面板后的兜底：tabs 丢了但 Rust PTY 仍在时，
 * 用它把存活会话灌回来（也能顺手清掉已退出的孤儿 tab）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useState } from 'react'
import { toast } from 'sonner'

import { TerminalTabs } from '@/features/terminal/terminal-tabs'
import { bootstrapTerminalSessions } from '@/features/terminal/agent-tabs'
import { useTerminalStore } from '@/stores/terminal'

interface TerminalSurfaceProps {
  cwd?: string | null
  emptyCwdMessage?: string
  /** 关闭时回调；默认关闭终端 store 面板并清空会话 */
  onClose?(): void
  title?: string
  /** 右栏是否处于终端页签；false 时不挂 xterm，避免透明层白屏 */
  paneVisible?: boolean
}

function TerminalSurface(props: TerminalSurfaceProps) {
  const closePanel = useTerminalStore(function (state) {
    return state.closePanel
  })
  const closeAllSessions = useTerminalStore(function (state) {
    return state.closeAllSessions
  })
  const tabCount = useTerminalStore(function (state) {
    return state.tabs.length
  })
  const [isSyncing, updateSyncing] = useState(false)

  function handleClose() {
    if (props.onClose) {
      props.onClose()
      return
    }
    closePanel()
  }

  function handleKillAll() {
    closeAllSessions()
  }

  function handleSync() {
    updateSyncing(true)
    void bootstrapTerminalSessions()
      .then(function () {
        const count = useTerminalStore.getState().tabs.length
        toast.success(count > 0 ? `已同步 ${count} 个终端会话` : '没有存活的后台会话')
      })
      .finally(function () {
        updateSyncing(false)
      })
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <Icon
          icon="lucide:terminal"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-foreground truncate text-xs font-medium">
          {props.title ?? '终端'}
        </span>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums">
          {tabCount}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="同步后台会话"
            title="同步：把仍然存活的后台终端会话灌回来（刷新页面后用它）"
            className="text-muted-foreground hover:text-foreground size-6"
            disabled={isSyncing}
            onClick={handleSync}>
            <Icon
              icon="lucide:refresh-cw"
              className={isSyncing ? 'size-3.5 animate-spin' : 'size-3.5'}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="结束全部会话"
            title="结束全部终端会话：会终止里面的进程（包括 agent 正在跑的命令）"
            className="text-muted-foreground hover:text-destructive size-6"
            disabled={tabCount === 0}
            onClick={handleKillAll}>
            <Icon
              icon="lucide:trash-2"
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="收起终端面板"
            title="收起面板（会话保留在后台，可从「同步后台会话」找回）"
            className="text-muted-foreground hover:text-foreground size-6"
            onClick={handleClose}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
      {/* flex-1 给内容区真实高度：否则 h-full 子节点量到 0 → xterm fit 失败 → 白屏 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <TerminalTabs
          cwd={props.cwd}
          emptyCwdMessage={props.emptyCwdMessage}
          paneVisible={props.paneVisible}
        />
      </div>
    </div>
  )
}

export { TerminalSurface }
export type { TerminalSurfaceProps }
