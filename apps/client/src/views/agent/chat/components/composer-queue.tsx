/**
 * composer 队列（app 版）：assistant-ui message-queue 元素 + 三件库没有的能力。
 *
 * 元素本身负责版面（默认折叠、每条一行、最大高度、立即发 / 删除），这里只补：
 * - **取回编辑**：`remove()` + 文本回输入框（库没有 `edit`，这是唯一只用公开 API 的做法）
 * - **上移 / 下移**：`move({ lane:'queue', insertBefore|insertAfter })`
 * - **上次没发出去的**：会话已结束时回灌出来的历史队列，逐条发或丢
 *
 * 折叠、封顶、去重这些版面约束都在 `MessageQueue` 里，别再在这里重写一遍。
 */
import { useAui, useAuiState, type AssistantClient } from '@assistant-ui/react'
import { ComposerChipText, resolveComposerChipLabel } from '@cogito/design/assistant/composer-chip-text'
import { focusComposerInput } from '@cogito/design/assistant/composer-input.aui'
import { field, ghostButton, mono } from '@cogito/design/assistant/elements/surfaces'
import { useAssistantLabels, type AssistantLabels } from '@cogito/design/assistant/labels'
import { MessageQueue, QueueLineBadge, type MessageQueueItemInfo } from '@cogito/design/assistant/message-queue.aui'
import { TooltipIconButton } from '@cogito/design/assistant/tooltip-icon-button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useCallback, useEffect, useSyncExternalStore, type FC, type ReactNode } from 'react'

import {
  dropPendingItem,
  readPendingQueue,
  reconcileComposerQueue,
  sendPendingItem,
  subscribePendingQueue,
  useComposerQueuePersist
} from '@/features/agent/composer-queue'

function renderQueueText(text: string): ReactNode {
  return (
    <ComposerChipText
      text={text}
      singleLine
      resolveLabel={resolveComposerChipLabel}
    />
  )
}

function findQueueIds(queue: readonly { id: string }[]): string[] {
  return queue.map(function (item) {
    return item.id
  })
}

function moveQueueItem(
  aui: AssistantClient,
  ids: readonly string[],
  index: number,
  direction: -1 | 1
): void {
  const target = ids[index]
  const anchor = ids[index + direction]
  if (!target || !anchor) return
  const handle = aui.composer.queueItem({ id: target })
  handle.move(
    direction === -1
      ? { lane: 'queue', insertBefore: anchor }
      : { lane: 'queue', insertAfter: anchor }
  )
}

/** 取回编辑：先移出队列，把文本并回输入框，再把焦点交回编辑器 */
function takeBackToComposer(aui: AssistantClient, id: string, text: string): void {
  aui.composer.queueItem({ id }).remove()
  const draft = aui.composer.getState().text
  aui.composer.setText(draft.length > 0 ? `${draft} ${text}` : text)
  // 按钮会随队列行一起卸载，焦点会掉到 body：这里显式交回编辑器并把光标落到末尾
  focusComposerInput()
}

function renderItemActions(
  aui: AssistantClient,
  ids: readonly string[],
  labels: AssistantLabels
): (item: MessageQueueItemInfo) => ReactNode {
  return function itemActions(item: MessageQueueItemInfo) {
    return (
      <>
        <TooltipIconButton
          tooltip={labels.queueTakeBack}
          side="top"
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ghostButton, 'size-6 shrink-0')}
          aria-label={labels.queueTakeBack}
          onClick={function () {
            takeBackToComposer(aui, item.id, item.text)
          }}>
          <Icon
            icon="lucide:pencil-line"
            className="size-3.5"
          />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip={labels.queueMoveUp}
          side="top"
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ghostButton, 'size-6 shrink-0 disabled:opacity-30')}
          aria-label={labels.queueMoveUp}
          disabled={item.index === 0}
          onClick={function () {
            moveQueueItem(aui, ids, item.index, -1)
          }}>
          <Icon
            icon="lucide:chevron-up"
            className="size-3.5"
          />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip={labels.queueMoveDown}
          side="top"
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ghostButton, 'size-6 shrink-0 disabled:opacity-30')}
          aria-label={labels.queueMoveDown}
          disabled={item.index === ids.length - 1}
          onClick={function () {
            moveQueueItem(aui, ids, item.index, 1)
          }}>
          <Icon
            icon="lucide:chevron-down"
            className="size-3.5"
          />
        </TooltipIconButton>
      </>
    )
  }
}

const ComposerQueue: FC = function ComposerQueue() {
  const aui = useAui()
  const sessionID = useAuiState(function (state) {
    const mainThreadId = state.threads.mainThreadId
    const item = state.threads.threadItems.find(function (entry) {
      return entry.id === mainThreadId
    })
    return item?.remoteId ?? null
  })
  const queue = useAuiState(function (state) {
    return state.composer.queue
  })
  const labels = useAssistantLabels()

  // 回灌只在会话就绪那一刻做一次：`isRunning` 故意不进依赖，
  // 否则每轮结束都会再读一次库、把刚发出去的消息重灌一遍。
  useEffect(
    function () {
      if (!sessionID) return
      const running = aui.thread.getState().isRunning
      void reconcileComposerQueue(aui, sessionID, { isRunning: running }).catch(function (error: unknown) {
        console.warn('[composer-queue] 回灌失败', error)
      })
    },
    [aui, sessionID]
  )

  useComposerQueuePersist(sessionID, queue)

  const pending = useSyncExternalStore(
    useCallback(function (listener: () => void) {
      return subscribePendingQueue(listener)
    }, []),
    function () {
      return readPendingQueue(sessionID)
    },
    function () {
      return readPendingQueue(null)
    }
  )

  if (queue.length === 0 && pending.length === 0) return null

  return (
    <MessageQueue
      extraCount={pending.length}
      extraPreview={pending[0]?.text ?? ''}
      renderText={renderQueueText}
      renderItemActions={renderItemActions(aui, findQueueIds(queue), labels)}>
      {pending.length > 0 ? (
        <div
          data-slot="message-queue-pending"
          className="flex flex-col gap-1.5">
          <div className={cn(mono, 'px-1')}>{labels.queuePendingHeading(pending.length)}</div>
          {pending.map(function (item) {
            return (
              <div
                key={item.id}
                data-slot="message-queue-pending-item"
                title={item.text}
                className={cn(field, 'group flex items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3')}>
                <Icon
                  icon="lucide:clock"
                  className="text-foreground/25 size-3.5 shrink-0"
                  aria-hidden
                />
                <div className="text-foreground/60 min-w-0 flex-1 truncate text-sm">
                  <ComposerChipText
                    text={item.text}
                    singleLine
                    resolveLabel={resolveComposerChipLabel}
                  />
                </div>
                <QueueLineBadge text={item.text} />
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <TooltipIconButton
                    tooltip={labels.queuePendingSend}
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(ghostButton, 'size-6 shrink-0')}
                    aria-label={labels.queuePendingSend}
                    onClick={function () {
                      if (!sessionID) return
                      sendPendingItem(aui, sessionID, item.id)
                    }}>
                    <Icon
                      icon="lucide:send"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip={labels.queuePendingDrop}
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(ghostButton, 'size-6 shrink-0')}
                    aria-label={labels.queuePendingDrop}
                    onClick={function () {
                      if (!sessionID) return
                      dropPendingItem(sessionID, item.id)
                    }}>
                    <Icon
                      icon="lucide:trash-2"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </MessageQueue>
  )
}

export { ComposerQueue }
