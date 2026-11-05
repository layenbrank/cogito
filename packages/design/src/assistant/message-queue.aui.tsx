/**
 * assistant-ui「message queue」元素（https://www.assistant-ui.com/elements/message-queue）的
 * 本仓实现。元素本体是收费产物，官网只给了 via-runtime 示例块：这里照示例的版面重写视觉
 * （`field` / `ghostButton` / `mono` 三条 token + `rounded-2xl py-2 pr-2 pl-3` 的行），
 * 内在行为（折叠、封顶、行内动作、与 app 的衔接）全部自己实现。
 *
 * 与官方示例的有意差异：
 * - 不渲染官方顶部那条「正在运行」行：当前轮的用户消息已经在对话流里，
 *   再在输入框上方重复一遍会被读成「消息重复了」。
 * - 默认折叠成「N queued + 第一条的一行预览」：官方示例永远展开，
 *   一次排队就把聊天区顶掉半个屏幕。
 * - 展开体 `max-h-44` + 滚动，每条 `truncate` 只占一行。
 * - 正文与追加动作可注入：app 用它把 `@chip` 渲染成简短标签、
 *   并挂上「取回编辑 / 上移 / 下移」这些库没有对应 primitive 的操作。
 */
import { ComposerPrimitive, QueueItemPrimitive, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState, type FC, type ReactNode } from 'react'

import { field, ghostButton, mono, rowEnter } from './elements/surfaces'
import { useAssistantLabels } from './labels'
import { TooltipIconButton } from './tooltip-icon-button'

/** 队列条目里的一行正文上限：`max-h-44` 约 4 行，再多就该滚了 */
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
      className={cn('flex w-full flex-col gap-2', className)}>
      <button
        type="button"
        data-slot="message-queue-header"
        aria-expanded={expanded}
        aria-label={expanded ? labels.queueCollapse : labels.queueExpand}
        title={expanded ? labels.queueCollapse : labels.queueExpand}
        onClick={toggle}
        className="group hover:bg-foreground/[0.03] flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors">
        <span className={cn(mono, 'shrink-0 tabular-nums')}>{labels.queuedMessages(total)}</span>
        {expanded ? (
          isRunning ? (
            <span className={cn(mono, 'min-w-0 flex-1 truncate')}>{labels.queueStopHint}</span>
          ) : (
            <span className="flex-1" />
          )
        ) : (
          <span className="text-foreground/60 min-w-0 flex-1 truncate text-sm">
            {previewText ? renderBody(previewText) : labels.queueEmptyPreview}
          </span>
        )}
        <Icon
          icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
          className="text-foreground/25 group-hover:text-foreground/60 size-3 shrink-0 transition-colors"
        />
      </button>

      {expanded ? (
        <div
          data-slot="message-queue-body"
          className={cn(
            'flex flex-col gap-1.5 overflow-y-auto overscroll-contain px-1',
            LIST_MAX_HEIGHT_CLASS
          )}>
          <ul
            data-slot="message-queue-list"
            className="flex flex-col gap-1.5">
            <ComposerPrimitive.Queue>
              {function renderQueuedItem({ queueItem }) {
                const index = ids.indexOf(queueItem.id)
                const text = textOfParts(queueItem.parts)
                return (
                  <li
                    key={queueItem.id}
                    data-slot="message-queue-item"
                    title={text}
                    className={cn(
                      field,
                      rowEnter,
                      'group/row flex items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3'
                    )}>
                    <span className={cn(mono, 'w-3 shrink-0 tabular-nums')}>{index + 1}</span>
                    <span className="text-foreground/60 min-w-0 flex-1 truncate text-sm">
                      {renderBody(text)}
                    </span>
                    {renderItemActions ? (
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                        {renderItemActions({ id: queueItem.id, index, text })}
                      </span>
                    ) : null}
                    <QueueItemPrimitive.Steer asChild>
                      <TooltipIconButton
                        tooltip={labels.queueSteerNow}
                        side="top"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(ghostButton, 'size-6 shrink-0')}
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
                        className={cn(ghostButton, 'size-6 shrink-0')}
                        aria-label={labels.queueRemove}>
                        <Icon
                          icon="lucide:x"
                          className="size-3.5"
                        />
                      </TooltipIconButton>
                    </QueueItemPrimitive.Remove>
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
