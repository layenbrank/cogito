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
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  addQueueAttachments,
  dropPendingItem,
  markThreadRunning,
  movePendingItem,
  parseQueueAttachments,
  persistComposerQueue,
  pumpPendingQueue,
  queueAttachmentLabel,
  queueItemAttachments,
  readPendingQueue,
  reconcileComposerQueue,
  sendPendingItem,
  subscribePendingQueue,
  useComposerQueuePersist,
  type QueueAttachment
} from '@/features/agent/composer-queue'

/**
 * 「空闲」先等这么久再补发：刷新恢复那一瞬 `thread.isRunning` 还没被 resume 置位，
 * 立刻补发会抢在接回的后台回合前面。
 */
const RESUME_SETTLE_MS = 1_200

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

/**
 * 取回编辑：先移出队列，把正文并回输入框、附件挂回 composer，再把焦点交回编辑器。
 *
 * 附件必须跟着回来 —— 只还正文的话，用户点一下「取回编辑」，图就再也找不到了。
 */
function takeBackToComposer(
  aui: AssistantClient,
  id: string,
  text: string,
  attachments: readonly QueueAttachment[]
): void {
  aui.composer.queueItem({ id }).remove()
  const draft = aui.composer.getState().text
  aui.composer.setText(draft.length > 0 ? `${draft} ${text}` : text)
  void addQueueAttachments(aui, attachments)
  // 按钮会随队列行一起卸载，焦点会掉到 body：这里显式交回编辑器并把光标落到末尾
  focusComposerInput()
}

/** 队列行上的附件角标：只有一个纸别针 + 条数，文件名放 `title` 里 */
function QueueAttachmentBadge(props: { attachments: readonly QueueAttachment[] }) {
  if (props.attachments.length === 0) return null
  const title = props.attachments.map(queueAttachmentLabel).join('\n')
  return (
    <span
      data-slot="message-queue-attachments"
      title={title}
      className={cn(
        mono,
        'text-foreground/40 flex shrink-0 items-center gap-1 text-[11px] leading-none'
      )}>
      <Icon
        icon="lucide:paperclip"
        className="size-3"
        aria-hidden
      />
      {props.attachments.length}
    </span>
  )
}

function renderItemActions(
  aui: AssistantClient,
  ids: readonly string[],
  labels: AssistantLabels,
  attachmentsById: ReadonlyMap<string, readonly QueueAttachment[]>
): (item: MessageQueueItemInfo) => ReactNode {
  return function itemActions(item: MessageQueueItemInfo) {
    const attachments = attachmentsById.get(item.id) ?? []
    return (
      <>
        <QueueAttachmentBadge attachments={attachments} />
        <TooltipIconButton
          tooltip={labels.queueTakeBack}
          side="top"
          type="button"
          variant="ghost"
          size="icon"
          className={cn(ghostButton, 'size-6 shrink-0')}
          aria-label={labels.queueTakeBack}
          onClick={function () {
            takeBackToComposer(aui, item.id, item.text, attachments)
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
  /** 排队消息的附件（库的队列状态里带着 part，但只有一个 text 文案被渲染） */
  const queueAttachments = useMemo(function () {
    const map = new Map<string, readonly QueueAttachment[]>()
    for (const item of queue) map.set(item.id, queueItemAttachments(item))
    return map
  }, [queue])
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
   * 补发闸门：会话刚就绪时 `thread.isRunning` 可能还没被 `unstable_resume` 置位，
   * 直接补发会抢在接回的后台回合前面。首次观察到「空闲」时先跳过，过一个小窗口再确认一次。
   *
   * 按**会话**记（而不是一个布尔）：组件不会随会话切换重挂，布尔一旦置真，
   * 下一个会话的「首次确认」就被跳过了。
   */
  const armedSession = useRef<string | null>(null)

  /**
   * 自走泵：本轮结束 → 发队首一条「待发送」→ 线程重新进入运行 → 结束后再发下一条。
   * 以前 UI 上写着「本轮结束后自动发送」，却没有任何代码去发，用户只能干等。
   */
  useEffect(
    function () {
      if (!sessionID) return
      if (isRunning) {
        markThreadRunning(sessionID)
        armedSession.current = sessionID
        return
      }
      if (pending.length === 0) return
      if (armedSession.current !== sessionID) {
        armedSession.current = sessionID
        const timer = window.setTimeout(function () {
          // 窗口过后仍在空闲才真的补发：刷新恢复的那一瞬不足以确认「没有后台回合」
          if (!aui.thread.getState().isRunning) void pumpPendingQueue(aui, sessionID)
        }, RESUME_SETTLE_MS)
        return function () {
          window.clearTimeout(timer)
        }
      }
      void pumpPendingQueue(aui, sessionID)
      return undefined
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
      renderItemActions={renderItemActions(
        aui,
        findQueueIds(queue),
        labels,
        queueAttachments
      )}>
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
                <QueueAttachmentBadge attachments={parseQueueAttachments(item.attachments)} />
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
                      void sendPendingItem(aui, sessionID, item.id).then(function (sent) {
                        if (!sent) toast.error('现在发不出去：对话未就绪或正在提交，稍后重试')
                      })
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
