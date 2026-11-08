/**
 * composer 队列（app 版）：assistant-ui message-queue 元素 + 三件库没有的能力。
 *
 * 元素本身负责版面（默认折叠、每条一行、最大高度、立即发 / 删除），这里只补：
 * - **取回编辑**：`remove()` + 文本回输入框（库没有 `edit`，这是唯一只用公开 API 的做法）
 * - **上移 / 下移**：`move({ insertBefore|insertAfter })`，lane 由库按条目自身推断
 *   （条目在 `steer` / `queue` 哪条 lane 前端看不到，写死必炸，见 `moveQueueItem`）
 * - **上次没发出去的**：会话已结束时回灌出来的历史队列，逐条发或丢
 *
 * 折叠、封顶、去重这些版面约束都在 `MessageQueue` 里，别再在这里重写一遍。
 */
import { useAui, useAuiState, type AssistantClient } from '@assistant-ui/react'
import { ComposerChipText, resolveComposerChipLabel } from '@cogito/design/assistant/composer-chip-text'
import { focusComposerInput } from '@cogito/design/assistant/composer-input.aui'
import { field, ghostButton, mono } from '@cogito/design/assistant/elements/surfaces'
import { useAssistantLabels, type AssistantLabels } from '@cogito/design/assistant/labels'
import { MessageQueue, QueueLineBadge, QueueOrderControls, QUEUE_ROW_PAD_CLASS, type MessageQueueItemInfo } from '@cogito/design/assistant/message-queue.aui'
import { TooltipIconButton } from '@cogito/design/assistant/tooltip-icon-button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useCallback, useEffect, useSyncExternalStore, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  dropPendingItem,
  markThreadRunning,
  movePendingItem,
  persistComposerQueue,
  pumpPendingQueue,
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

/** 队列的两条 lane：`steer`（运行中排队的新消息都落这里）与 `queue` */
type QueueLane = 'queue' | 'steer'

/**
 * 试探顺序：先不指定 lane（内核按条目**自己所在的 lane** 放），
 * 被拒再显式点名两条 lane —— 锚点只存在于它自己那条 lane，所以第二轮一定命中。
 */
const LANE_ATTEMPTS: readonly (QueueLane | undefined)[] = [undefined, 'steer', 'queue']

/**
 * 上移 / 下移一条排队消息。
 *
 * **坑（"无法插队"的根因）**：库的 `move(id, placement)` 要求**锚点与目的一条 lane**，
 * 而 `composer.queue` 给的是 `[...steer, ...queue]` 的扁平数组，前端看不出归属。
 * 以前这里把 lane 写死成 `'queue'`：运行中排队的消息其实都在 `steer` lane
 * （`append()` 在有 run 在飞时一律进 steer），于是随便点一下上移/下移就抛
 * `Unknown anchor "…" in lane "queue"`；事件处理器里没人接，用户看到的就是
 * 「点了没反应、插不了队」。
 *
 * 返回是否真的挪动了：两次都被拒时由调用方给一句提示，别再静默失败。
 */
function moveQueueItem(
  aui: AssistantClient,
  ids: readonly string[],
  index: number,
  direction: -1 | 1
): boolean {
  const target = ids[index]
  const anchor = ids[index + direction]
  if (!target || !anchor) return false
  const handle = aui.composer.queueItem({ id: target })
  const isBefore = direction === -1
  const lastLane = LANE_ATTEMPTS[LANE_ATTEMPTS.length - 1]

  for (const lane of LANE_ATTEMPTS) {
    try {
      if (!lane) {
        handle.move(isBefore ? { insertBefore: anchor } : { insertAfter: anchor })
      } else {
        handle.move(
          isBefore ? { lane, insertBefore: anchor } : { lane, insertAfter: anchor }
        )
      }
      return true
    } catch (error) {
      // 前两次被拒是预期内的（锚点在另一条 lane）；最后一次还失败才值得记一笔
      if (lane === lastLane) console.warn('[composer-queue] 调整顺序失败', error)
    }
  }

  return false
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
        <QueueOrderControls
          upLabel={labels.queueMoveUp}
          downLabel={labels.queueMoveDown}
          canMoveUp={item.index > 0}
          canMoveDown={item.index < ids.length - 1}
          onMoveUp={function () {
            if (moveQueueItem(aui, ids, item.index, -1)) return
            toast.error('上移失败：队列正忙或条目已变化')
          }}
          onMoveDown={function () {
            if (moveQueueItem(aui, ids, item.index, 1)) return
            toast.error('下移失败：队列正忙或条目已变化')
          }}
        />
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

  // 会话是否在跑：决定「待发送」能不能补发（跑起来就等它结束）
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })

  /**
   * 自走泵：本轮结束 → 发队首一条「待发送」→ 线程重新进入运行 → 结束后再发下一条。
   * 以前 UI 上写着「本轮结束后自动发送」，却没有任何代码去发，用户只能干等。
   */
  useEffect(
    function () {
      if (!sessionID) return
      if (isRunning) {
        markThreadRunning(sessionID)
        return
      }
      if (pending.length === 0) return
      pumpPendingQueue(aui, sessionID)
    },
    [aui, isRunning, pending, sessionID]
  )

  /** 调完顺序立刻落库：库里 `sort` 就是数组顺序，等下次队列变化再写会丢序 */
  function persistPendingOrder() {
    if (!sessionID) return
    void persistComposerQueue(sessionID, aui.composer.getState().queue).catch(function (
      error: unknown
    ) {
      console.warn('[composer-queue] 落库失败', error)
    })
  }

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
          <div className={cn(mono, QUEUE_ROW_PAD_CLASS)}>{labels.queuePendingHeading(pending.length)}</div>
          {pending.map(function (item, index) {
            return (
              <div
                key={item.id}
                data-slot="message-queue-pending-item"
                title={item.text}
                className={cn(
                  field,
                  'group flex items-center gap-2.5 rounded-2xl py-2',
                  QUEUE_ROW_PAD_CLASS
                )}>
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
                  <QueueOrderControls
                    upLabel={labels.queueMoveUp}
                    downLabel={labels.queueMoveDown}
                    canMoveUp={index > 0}
                    canMoveDown={index < pending.length - 1}
                    onMoveUp={function () {
                      if (!sessionID) return
                      if (movePendingItem(sessionID, item.id, -1)) persistPendingOrder()
                    }}
                    onMoveDown={function () {
                      if (!sessionID) return
                      if (movePendingItem(sessionID, item.id, 1)) persistPendingOrder()
                    }}
                  />
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
                    {/* 与队列行同一个语义、同一个图标：这条现在就发（⚡），不是「发送键」 */}
                    <Icon
                      icon="lucide:zap"
                      className="text-foreground/40 size-3.5 shrink-0"
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
