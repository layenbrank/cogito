import { useAui, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { useCallback, type FC } from 'react'

import { useAssistantLabels } from './labels'
import { MessageQueue } from './message-queue.aui'
import { TooltipIconButton } from './tooltip-icon-button'

const ComposerSendButton: FC = () => {
  const aui = useAui()
  const labels = useAssistantLabels()
  const disabled = useAuiState(function (state) {
    return !state.composer.canSend || (state.thread.isRunning && !state.thread.capabilities.queue)
  })
  const tooltip = useAuiState(function (state) {
    if (state.thread.isRunning && state.thread.capabilities.queue) return labels.sendQueued
    return labels.send
  })
  // 运行中队列非空：按钮上直接显示还有几条在等，避免「发了但没反应」
  const queuedCount = useAuiState(function (state) {
    return state.thread.isRunning ? state.composer.queue.length : 0
  })

  const onSend = useCallback(
    function onSend() {
      const threadState = aui.thread.getState()
      const steer = !(threadState.isRunning && threadState.capabilities.queue)
      aui.composer.send(steer ? undefined : { steer: false })
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

export { ComposerQueueList, ComposerQueuedStrip, ComposerSendButton, findComposerPlaceholder }
