/**
 * 编排台底部双通道（对齐 VS Code）：
 * - 输出：corex 进度帧只读日志
 * - 终端：原生 PTY（features/terminal），不灌帧
 *
 * 终端视图用 `invisible` 保活（禁止 `hidden`/`display:none`），
 * 否则 xterm FitAddon 量到 0 列，切回「终端」会白屏且无法输入。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { TerminalTabs } from '@/features/terminal'
import { useTerminalStore } from '@/stores/terminal'

import { RunPanelLog } from './run-panel-log.tsx'

type ConsoleChannel = 'output' | 'terminal'

interface RunPanelConsoleProps {
  channel: ConsoleChannel
  onChannelChange: (channel: ConsoleChannel) => void
  logText: string
  logPlaceholder: string
  isFollowing: boolean
  onFollowingChange: (following: boolean) => void
  cwd: string | null
  emptyCwdMessage: string
}

function RunPanelConsole(props: RunPanelConsoleProps) {
  const isTerminal = props.channel === 'terminal'
  // 首次点开「终端」后再挂载 PTY，之后用 invisible 保活，不往壳里灌 corex 帧
  const [hasOpenedTerminal, setHasOpenedTerminal] = useState(false)

  useEffect(
    function () {
      if (!isTerminal) return
      setHasOpenedTerminal(true)
      if (!props.cwd) {
        toast.error(props.emptyCwdMessage)
        return
      }
      if (useTerminalStore.getState().tabs.length > 0) return
      // 编排台内嵌：不掀开列表底栏 / agent 右栏
      useTerminalStore.getState().newTab(props.cwd, { reveal: false })
    },
    [isTerminal, props.cwd, props.emptyCwdMessage]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/20 px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            'h-6 rounded-sm px-2 text-xs',
            props.channel === 'output'
              ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
              : 'text-muted-foreground'
          )}
          onClick={function () {
            props.onChannelChange('output')
          }}>
          <Icon
            icon="lucide:scroll-text"
            className="mr-1 size-3.5"
          />
          输出
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            'h-6 rounded-sm px-2 text-xs',
            props.channel === 'terminal'
              ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
              : 'text-muted-foreground'
          )}
          onClick={function () {
            props.onChannelChange('terminal')
          }}>
          <Icon
            icon="lucide:terminal"
            className="mr-1 size-3.5"
          />
          终端
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'absolute inset-0 flex flex-col p-2',
            props.channel !== 'output' && 'pointer-events-none invisible'
          )}
          aria-hidden={props.channel !== 'output' || undefined}>
          <RunPanelLog
            logText={props.logText}
            placeholder={props.logPlaceholder}
            isFollowing={props.isFollowing}
            onFollowingChange={props.onFollowingChange}
          />
        </div>
        {hasOpenedTerminal ? (
          <div
            className={cn(
              'absolute inset-0',
              props.channel !== 'terminal' && 'pointer-events-none invisible'
            )}
            aria-hidden={props.channel !== 'terminal' || undefined}>
            <TerminalTabs
              cwd={props.cwd}
              emptyCwdMessage={props.emptyCwdMessage}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { RunPanelConsole }
export type { ConsoleChannel }
