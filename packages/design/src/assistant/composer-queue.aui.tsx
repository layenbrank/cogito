import { ComposerPrimitive, QueueItemPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { useCallback, type FC } from 'react'

import { useAssistantLabels } from './labels'
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

const ComposerQueueList: FC = () => {
  const labels = useAssistantLabels()
  const queuedCount = useAuiState(function (state) {
    return state.composer.queue.length
  })

  if (queuedCount === 0) return null

  return (
    <div
      data-slot="aui_composer-queue"
      className="border-border/60 bg-muted/30 mb-2 flex flex-col gap-1 rounded-lg border px-2 py-1.5">
      <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs font-medium tracking-wide uppercase">
        <Icon
          icon="lucide:list-ordered"
          className="size-3 shrink-0 opacity-70"
        />
        {labels.queueHeading}
        <span className="text-muted-foreground/70 ml-auto normal-case">
          {labels.queueStopHint}
        </span>
      </div>
      <ComposerPrimitive.Queue>
        {function () {
          return (
            <div
              data-slot="aui_composer-queue-item"
              className="group flex items-start gap-2 rounded-md px-1 py-1">
              <Icon
                icon="lucide:grip-vertical"
                className="text-muted-foreground/50 mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
              <div className="min-w-0 flex-1 text-sm leading-snug">
                <QueueItemPrimitive.Text className="text-foreground line-clamp-2" />
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <QueueItemPrimitive.Steer asChild>
                  <TooltipIconButton
                    tooltip={labels.queueSteerNow}
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={labels.queueSteerNow}>
                    <Icon
                      icon="lucide:zap"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                </QueueItemPrimitive.Steer>
                <QueueItemPrimitive.Remove asChild>
                  <TooltipIconButton
                    tooltip={labels.queueRemove}
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7"
                    aria-label={labels.queueRemove}>
                    <Icon
                      icon="lucide:x"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                </QueueItemPrimitive.Remove>
              </div>
            </div>
          )
        }}
      </ComposerPrimitive.Queue>
    </div>
  )
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
