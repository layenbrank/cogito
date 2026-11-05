import { useAui, useAuiState, type AssistantClient } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { useCallback, type FC, type MouseEvent } from 'react'

import { useAssistantLabels } from './labels'
import { MessageQueue } from './message-queue.aui'
import { TooltipIconButton } from './tooltip-icon-button'

/**
 * 发送语义的唯一出口：键盘（Enter / Ctrl+Enter）与发送按钮都走这里。
 *
 * 运行中且线程支持队列时：默认**入队**，`steer` 为真才**插队**（打断当前轮立刻处理）。
 * 运行中但队列不可用 / 草稿空 / 线程禁用：返回 `false`，调用方保持「没发出去」的原样。
 */
function sendFromComposer(aui: AssistantClient, options?: { steer?: boolean }): boolean {
  const thread = aui.thread.getState()
  const composer = aui.composer.getState()
  if (!composer.canSend) return false
  const queued = thread.isRunning && thread.capabilities.queue
  if (thread.isRunning && !queued) return false
  if (queued) {
    aui.composer.send({ steer: options?.steer === true })
    return true
  }
  aui.composer.send()
  return true
}

const ComposerSendButton: FC = () => {
  const aui = useAui()
  const labels = useAssistantLabels()
  const disabled = useAuiState(function (state) {
    return !state.composer.canSend || (state.thread.isRunning && !state.thread.capabilities.queue)
  })
  const tooltip = useAuiState(function (state) {
    if (state.thread.isRunning && state.thread.capabilities.queue) return labels.sendQueuedHint
    return labels.send
  })
  // 运行中队列非空：按钮上直接显示还有几条在等，避免「发了但没反应」
  const queuedCount = useAuiState(function (state) {
    return state.thread.isRunning ? state.composer.queue.length : 0
  })

  const onSend = useCallback(
    function onSend(event: MouseEvent<HTMLButtonElement>) {
      // 运行中：点击 = 入队，按住 Alt/Ctrl/Cmd = 插队（与键盘 Ctrl+Enter 同一语义）
      sendFromComposer(aui, { steer: event.altKey || event.ctrlKey || event.metaKey })
    },
    [aui]
  )

  if (disabled) return null

  return (
    <TooltipIconButton
      tooltip={tooltip}
      side="bottom"
      type="button"
      variant="default"
      size="icon"
      className="aui-composer-send bg-primary text-primary-foreground hover:bg-primary-hover relative size-8 shrink-0 rounded-lg shadow-none"
      aria-label={tooltip}
      onClick={onSend}>
      <Icon
        icon="lucide:arrow-up"
        className="aui-composer-send-icon size-4"
      />
      {queuedCount > 0 ? (
        <span
          title={labels.queuedMessages(queuedCount)}
          className="bg-primary-foreground/20 absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
          {queuedCount}
        </span>
      ) : null}
    </TooltipIconButton>
  )
}

/**
 * 输入框里那条**默认**队列：assistant-ui message-queue 元素的标准形态
 * （折叠标题 + 每条一行 + 立即发 / 删除）。
 *
 * app 需要「取回编辑 / 上移 / 下移」这类库没有 primitive 的操作时，
 * 会传自己的 `ComposerQueue`；那条同样基于 `MessageQueue`，只是多注入了行内动作。
 */
const ComposerQueueList: FC = function ComposerQueueList() {
  return <MessageQueue />
}

function findComposerPlaceholder(
  labels: ReturnType<typeof useAssistantLabels>,
  hasMessages: boolean,
  isRunning: boolean,
  queueEnabled: boolean
): string {
  if (isRunning && queueEnabled) return labels.composerPlaceholderRunning
  if (hasMessages) return labels.composerPlaceholderContinue
  return labels.composerPlaceholder
}

const ComposerQueuedStrip = ComposerQueueList

export { ComposerQueueList, ComposerQueuedStrip, ComposerSendButton, findComposerPlaceholder, sendFromComposer }
