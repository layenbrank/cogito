/**
 * composer 队列的自定义面板（替代 design 包里只有「立即发 / 删除」的默认条）。
 *
 * 能力对齐 VS Code Copilot Chat 的排队消息：
 * - **取回编辑**：`remove()` + 文本回输入框（库没有 `edit`，这是唯一只用公开 API 的做法）
 * - **删除**
 * - **上移 / 下移**（`move({ lane:'queue', insertBefore|insertAfter })`）
 * - **立即发**（`move({ lane:'steer' })`，会打断当前轮）
 *
 * 另外渲染「待发送」条：会话已结束时回灌出来的历史队列，用户回来后可以逐条发或丢。
 *
 * 版面约束：**默认折叠**，折叠态只留标题 + 第一条的一行预览；展开后每条也只占一行
 * （超长省略，完整文本进 title），列表区有最大高度、超出滚动 —— 否则一次排队就把
 * 输入区顶掉半个屏幕，聊天区没法看。
 */
import { useAui, useAuiState, type AssistantClient } from '@assistant-ui/react'
import { ComposerChipText, resolveComposerChipLabel } from '@cogito/design/assistant/composer-chip-text'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import { TooltipIconButton } from '@cogito/design/assistant/tooltip-icon-button'
import { Icon } from '@iconify/react/offline'
import { useCallback, useEffect, useState, useSyncExternalStore, type FC } from 'react'

import {
  dropPendingItem,
  readPendingQueue,
  reconcileComposerQueue,
  sendPendingItem,
  subscribePendingQueue,
  textOfQueueItem,
  useComposerQueuePersist
} from '@/features/agent/composer-queue'

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

const ComposerQueue: FC = function ComposerQueue() {
  const aui = useAui()
  const labels = useAssistantLabels()
  const [isOpen, setIsOpen] = useState(false)
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
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })

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

  const ids = findQueueIds(queue)
  const total = queue.length + pending.length
  const [firstQueued] = queue
  const [firstPending] = pending
  const preview = firstQueued ? textOfQueueItem(firstQueued) : (firstPending?.text ?? '')

  return (
    <div
      data-slot="cogito_composer-queue"
      className="border-border/60 bg-muted/30 mb-2 rounded-lg border">
      <button
        type="button"
        data-slot="cogito_composer-queue-toggle"
        aria-expanded={isOpen}
        aria-label={isOpen ? '收起队列' : '展开队列'}
        title={isOpen ? '收起队列' : '展开队列'}
        onClick={function () {
          setIsOpen(function (open) {
            return !open
          })
        }}
        className="hover:bg-accent/40 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors">
        <Icon
          icon="lucide:list-ordered"
          className="text-muted-foreground size-3 shrink-0 opacity-70"
        />
        <span className="text-muted-foreground shrink-0 tracking-wide uppercase">{labels.queueHeading}</span>
        <span className="text-muted-foreground/70 shrink-0 tabular-nums">{total}</span>
        {isOpen ? null : (
          <span className="text-muted-foreground/80 min-w-0 flex-1 truncate text-left text-xs font-normal">
            {preview || '（无文本）'}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {isOpen && isRunning ? (
            <span className="text-muted-foreground/70 max-w-40 truncate text-xs font-normal normal-case">
              {labels.queueStopHint}
            </span>
          ) : null}
          <Icon
            icon={isOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'}
            className="text-muted-foreground size-3.5 shrink-0 opacity-70"
          />
        </span>
      </button>

      {/* 展开后列表封顶（约 4 行），超出滚动：不把输入框往下顶 */}
      {isOpen ? (
        <div
          data-slot="cogito_composer-queue-body"
          className="flex max-h-44 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
          {queue.map(function (item, index) {
            const text = textOfQueueItem(item)
            return (
              <div
                key={item.id}
                data-slot="cogito_composer-queue-item"
                title={text}
                className="group hover:bg-accent/40 flex items-center gap-2 rounded-md px-1 py-1">
                <span className="text-muted-foreground/60 size-4 shrink-0 text-center text-xs tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 truncate text-sm leading-tight whitespace-nowrap">
                  <ComposerChipText
                    text={text}
                    resolveLabel={resolveComposerChipLabel}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <TooltipIconButton
                    tooltip="取回编辑"
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="取回编辑"
                    onClick={function () {
                      const handle = aui.composer.queueItem({ id: item.id })
                      handle.remove()
                      const draft = aui.composer.getState().text
                      aui.composer.setText(draft.length > 0 ? `${draft} ${text}` : text)
                    }}>
                    <Icon
                      icon="lucide:pencil-line"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip="上移"
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 disabled:opacity-30"
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={function () {
                      moveQueueItem(aui, ids, index, -1)
                    }}>
                    <Icon
                      icon="lucide:chevron-up"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip="下移"
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 disabled:opacity-30"
                    aria-label="下移"
                    disabled={index === ids.length - 1}
                    onClick={function () {
                      moveQueueItem(aui, ids, index, 1)
                    }}>
                    <Icon
                      icon="lucide:chevron-down"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip={labels.queueSteerNow}
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={labels.queueSteerNow}
                    onClick={function () {
                      aui.composer.queueItem({ id: item.id }).move({ lane: 'steer', insertAfter: null })
                    }}>
                    <Icon
                      icon="lucide:zap"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip={labels.queueRemove}
                    side="top"
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7"
                    aria-label={labels.queueRemove}
                    onClick={function () {
                      aui.composer.queueItem({ id: item.id }).remove()
                    }}>
                    <Icon
                      icon="lucide:x"
                      className="size-3.5"
                    />
                  </TooltipIconButton>
                </div>
              </div>
            )
          })}

          {pending.length > 0 ? (
            <div className="border-border/60 mt-0.5 flex flex-col gap-0.5 border-t pt-1">
              <div className="text-muted-foreground/80 px-1 text-xs">上次没发出去的（{pending.length}）</div>
              {pending.map(function (item) {
                return (
                  <div
                    key={item.id}
                    data-slot="cogito_composer-queue-pending"
                    title={item.text}
                    className="group hover:bg-accent/40 flex items-center gap-2 rounded-md px-1 py-1">
                    <Icon
                      icon="lucide:clock"
                      className="text-muted-foreground/60 size-3.5 shrink-0"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 truncate text-sm leading-tight whitespace-nowrap">
                      <ComposerChipText
                        text={item.text}
                        resolveLabel={resolveComposerChipLabel}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <TooltipIconButton
                        tooltip="发送这条"
                        side="top"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="发送这条"
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
                        tooltip="丢弃"
                        side="top"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-7"
                        aria-label="丢弃"
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
        </div>
      ) : null}
    </div>
  )
}

export { ComposerQueue }
