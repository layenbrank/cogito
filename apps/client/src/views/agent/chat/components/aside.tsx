/**
 * 右栏容器：空对话快捷卡 / 已对话分区骨架（对齐 Qoder）。
 */
import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useMemo } from 'react'

import { AsideBusy } from './aside-busy'
import { AsideEmpty } from './aside-empty'
import { TerminalPanel } from '@/features/terminal'
import type { PlanSnapshot } from '@/features/agent/plan'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { useTerminalStore } from '@/stores/terminal'

interface AsideProps {
  className?: string
  plan: PlanSnapshot | null
  onClose: () => void
}

function AgentAside(props: AsideProps) {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  const terminalOpen = useTerminalStore(function (state) {
    return state.open
  })
  const { primaryPath } = useActiveWorkspace()

  const hasUserMessage = useMemo(
    function () {
      return messages.some(function (message) {
        return message.role === 'user'
      })
    },
    [messages]
  )

  // 终端面板固定渲染在右栏；打开时整栏被终端面板接管（面板自带标题栏与关闭）。
  if (terminalOpen) {
    return (
      <div className={clsx('bg-background flex h-full min-h-0 flex-col', props.className)}>
        <TerminalPanel
          cwd={primaryPath}
          emptyCwdMessage="先在左栏添加一个工作区"
        />
      </div>
    )
  }

  return (
    <div className={clsx('bg-background flex h-full min-h-0 flex-col', props.className)}>
      <div className="border-border flex h-10 shrink-0 items-center justify-between gap-2 border-b px-2.5">
        <span className="text-muted-foreground truncate text-xs font-medium">
          {hasUserMessage ? '任务详情' : '快捷操作'}
        </span>
        {/* 收缩入口只在中栏 Head 的 panel-right；这里用 × 避免右侧出现两枚相同图标 */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-region="false"
          aria-label="关闭右侧栏"
          title="关闭右侧栏"
          className="text-muted-foreground hover:text-foreground size-7"
          onClick={props.onClose}>
          <Icon
            icon="lucide:x"
            className="size-3.5"
          />
        </Button>
      </div>
      {hasUserMessage ? <AsideBusy plan={props.plan} /> : <AsideEmpty />}
    </div>
  )
}

export { AgentAside }
