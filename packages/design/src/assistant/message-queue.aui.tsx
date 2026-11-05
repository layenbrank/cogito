/**
 * assistant-ui「message queue」元素（https://www.assistant-ui.com/elements/message-queue）的
 * 本仓实现：排队消息按顺序堆在输入框内、附件之上，**默认折叠成一行标题**，
 * 展开后每条只占一行、整块有最大高度 —— 否则一次排队就把聊天区顶掉半个屏幕。
 *
 * 与官方元素的差异（都是有意的）：
 * - 不渲染官方示例顶部那条「正在运行」行：当前轮的用户消息已经在对话流里，
 *   再在输入框上方重复一遍会被读成「消息重复了」。
 * - 折叠态保留**一条最短预览**（第一条的一行文本）：收起来只剩「3 queued」的话，
 *   用户不知道排的到底是哪几条。
 * - 行内正文与追加动作都可注入：app 用它把 `@chip` 渲染成简短标签、
 *   并挂上「取回编辑 / 上移 / 下移」这些库没有对应 primitive 的操作。
 */
import { ComposerPrimitive, QueueItemPrimitive, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState, type FC, type ReactNode } from 'react'

import { useAssistantLabels } from './labels'
import { TooltipIconButton } from './tooltip-icon-button'

/** 队列条目里的一行正文上限：`max-h-44` 大约 4 行，再多就该滚了 */
const LIST_MAX_HEIGHT_CLASS = 'max-h-44'

/**
 * 队列条目的纯文本，口径与 `QueueItemPrimitive.Text` 一致（多段正文用空行拼接）。
 * 入参用结构化的最小形状：`QueueItemState.parts` 是联合类型，这里只关心 text 段。
 */
function textOfParts(parts: readonly { readonly type: string }[]): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type !== 'text') continue
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string' && text.length > 0) chunks.push(text)
  }
  return chunks.join('\n\n')
}

type MessageQueueItemInfo = {
  /** 队列条目 id，能直接喂给 `aui.composer.queueItem({ id })` */
  id: string
  /** 在队列中的位置（从 0 开始），上移 / 下移要按它算锚点 */
  index: number
  /** 该条目的纯文本 */
  text: string
}

type MessageQueueProps = {
  className?: string
  /** 额外条目数（app 的「上次没发出去」）：参与标题计数与空态判断，本身由 `children` 渲染 */
  extraCount?: number
  /** 队列为空时折叠态的预览文本（此时第一条正文来自 `children`，元素自己看不到） */
  extraPreview?: string
  /** 展开态列表底部的附加内容，与排队消息同一个滚动区 */
  children?: ReactNode
  /** 默认折叠 */
  defaultOpen?: boolean
  /** 折叠状态受控；不传就走内部状态 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 正文渲染：默认纯文本，app 可以换成带 `@chip` 标签的版本 */
  renderText?: (text: string) => ReactNode
  /** 行内追加动作，渲染在「立即发 / 删除」之前 */
  renderItemActions?: (item: MessageQueueItemInfo) => ReactNode
}

const MessageQueue: FC<MessageQueueProps> = function MessageQueue({
  className,
  extraCount = 0,
  extraPreview = '',
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  renderText,
  renderItemActions
}) {
  const labels = useAssistantLabels()
  const queue = useAuiState(function (state) {
    return state.composer.queue
  })
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const expanded = open ?? uncontrolledOpen

  const total = queue.length + extraCount
  if (total === 0) return null

  const ids = queue.map(function (item) {
    return item.id
  })
  const first = queue[0]
  const previewText = first ? textOfParts(first.parts) : extraPreview
  const renderBody = renderText ?? defaultRenderText

  function toggle() {
    const next = !expanded
    if (open === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      data-slot="message-queue"
      className={cn('border-border/60 bg-muted/30 mb-2 flex flex-col rounded-lg border', className)}>
      <button
        type="button"
        data-slot="message-queue-header"
        aria-expanded={expanded}
        aria-label={expanded ? labels.queueCollapse : labels.queueExpand}
        title={expanded ? labels.queueCollapse : labels.queueExpand}
        onClick={toggle}
        className="hover:bg-accent/40 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors">
        <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide uppercase tabular-nums">
          {labels.queuedMessages(total)}
        </span>
        {expanded ? null : (
          <span className="text-muted-foreground/80 min-w-0 flex-1 truncate text-xs font-normal">
            {previewText ? renderBody(previewText) : labels.queueEmptyPreview}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {expanded && isRunning ? (
            <span className="text-muted-foreground/70 max-w-40 truncate text-xs font-normal">
              {labels.queueStopHint}
            </span>
          ) : null}
          <Icon
            icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
            className="text-muted-foreground size-3.5 shrink-0 opacity-70"
          />
        </span>
      </button>

      {expanded ? (
        <div
          data-slot="message-queue-body"
          className={cn(
            'flex flex-col gap-0.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5',
            LIST_MAX_HEIGHT_CLASS
          )}>
          <ul
            data-slot="message-queue-list"
            className="flex flex-col gap-0.5">
            <ComposerPrimitive.Queue>
              {function renderQueuedItem({ queueItem }) {
                const index = ids.indexOf(queueItem.id)
                const text = textOfParts(queueItem.parts)
                return (
                  <li
                    key={queueItem.id}
                    data-slot="message-queue-item"
                    title={text}
                    className="group hover:bg-accent/40 flex items-center gap-2 rounded-md px-1 py-1">
                    <span className="text-muted-foreground/60 size-4 shrink-0 text-center text-xs tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm leading-tight whitespace-nowrap">
                      {renderBody(text)}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {renderItemActions
                        ? renderItemActions({ id: queueItem.id, index, text })
                        : null}
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
                            icon="lucide:arrow-up"
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
                    </span>
                  </li>
                )
              }}
            </ComposerPrimitive.Queue>
          </ul>
          {children}
        </div>
      ) : null}
    </div>
  )
}

function defaultRenderText(text: string): ReactNode {
  return text
}

export { MessageQueue, LIST_MAX_HEIGHT_CLASS, textOfParts }
export type { MessageQueueItemInfo, MessageQueueProps }
