/**
 * assistant-ui「message queue」元素（https://www.assistant-ui.com/elements/message-queue）的
 * 本仓实现。元素本体是收费产物，官网只给了 via-runtime 示例块：这里照示例的版面重写视觉
 * （`field` / `ghostButton` / `mono` 三条 token + `rounded-2xl py-2 pr-2 pl-3` 的行），
 * 版面对齐元素渲染出的真实 DOM，字号走本仓档位（`text-xs` / `text-sm`），不照搬它的 px 值；
 * 内在行为（折叠、封顶、行内动作、与 app 的衔接）全部自己实现。
 *
 * 与官方示例的有意差异：
 * - 官方顶部那条「正在运行」行默认不渲染（传 `runningText` 才出）：线程里当前轮的用户消息
 *   已经在对话流里，再在输入框上方重复一遍会被读成「消息重复了」。
 * - 默认折叠成「N queued + 第一条的一行预览」：官方示例永远展开，
 *   一次排队就把聊天区顶掉半个屏幕。
 * - 展开体封顶 + 滚动，每条只占一行。单行不是靠父级 `truncate` 硬裁出来的：
 *   `@chip` 的渲染根节点带 `whitespace-pre-wrap` 与 `<br>`，会覆盖 `nowrap` 并让
 *   `text-overflow` 失效（多行文本既截不断也没有省略号）—— 所以 `singleLine` 传给正文
 *   渲染器，由它先把文档摊平（换行变空格、不渲染 `<br>`）。
 * - 多行条目在行尾给一个 `⏎ N 行` 标记：单行预览背后还有内容，全文仍在 `title` 里。
 * - 正文与追加动作可注入：app 用它把 `@chip` 渲染成简短标签、
 *   并挂上「取回编辑 / 上移 / 下移」这些库没有对应 primitive 的操作。
 */
import { ComposerPrimitive, QueueItemPrimitive, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState, type FC, type ReactNode } from 'react'

import { countComposerLines } from './composer-chip-text'
import { field, ghostButton, mono, rowEnter } from './elements/surfaces'
import { useAssistantLabels } from './labels'
import { TooltipIconButton } from './tooltip-icon-button'

/** 队列条目里的一行正文上限：`max-h-44` 约 4 行，再多就该滚了 */
const LIST_MAX_HEIGHT_CLASS = 'max-h-[min(11rem,32vh)]'

/** 一行条目的固定行高：chip 与纯文本混排时不至于一条高一条矮 */
const ROW_LINE_CLASS = 'py-2 leading-5'

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
  /**
   * 正在跑的那条文本。传了才渲染官方那条「running」行（蓝点 + 正文 + running 标签）。
   * 线程里默认不传：当前轮的用户消息已经在对话流里，再在输入框上方重复一遍会被读成「消息重复了」。
   */
  runningText?: string | undefined
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
  runningText,
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
      {runningText ? <MessageQueueRunningRow text={runningText} /> : null}
      <button
        type="button"
        data-slot="message-queue-header"
        aria-expanded={expanded}
        aria-label={expanded ? labels.queueCollapse : labels.queueExpand}
        title={
          expanded ? (isRunning ? labels.queueStopHint : labels.queueCollapse) : labels.queueExpand
        }
        onClick={toggle}
        className="group hover:bg-foreground/[0.03] flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors">
        <span className={cn(mono, 'shrink-0 tabular-nums')}>{labels.queuedMessages(total)}</span>
        {expanded ? (
          /* 展开态跟官方一致：右端对齐说清「什么时候会发」 */
          <span className={cn(mono, 'min-w-0 flex-1 truncate text-right')}>
            {labels.queueSendsWhenFinishes}
          </span>
        ) : (
          <span
            className="text-foreground/60 min-w-0 flex-1 truncate text-sm"
            title={previewText || undefined}>
            {previewText ? renderBody(previewText) : labels.queueEmptyPreview}
          </span>
        )}
        {expanded ? null : <QueueLineBadge text={previewText} />}
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
                      ROW_LINE_CLASS,
                      'group/row flex items-center gap-2.5 rounded-2xl pr-2 pl-3'
                    )}>
                    <span className={cn(mono, 'w-3 shrink-0 tabular-nums')}>{index + 1}</span>
                    <span className="text-foreground/60 min-w-0 flex-1 truncate text-sm">
                      {renderBody(text)}
                    </span>
                    <QueueLineBadge text={text} />
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
                          className="text-foreground/25 size-3 shrink-0"
                        />
                      </TooltipIconButton>
                    </QueueItemPrimitive.Steer>
                    <QueueItemPrimitive.Remove asChild>
                      <TooltipIconButton
                        tooltip={labels.queueRemoveItem(text)}
                        side="top"
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(ghostButton, 'size-6 shrink-0')}
                        aria-label={labels.queueRemoveItem(text)}>
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

/**
 * 多行标记：单行预览背后还有内容（`⏎ N 行`）。全文仍在 `title` 里。
 *
 * 折叠头与队列条目共用，`pending` 行也复用它 —— 计数口径来自
 * `composer-chip-text` 的 `countComposerLines`，与实际显示行数一致。
 */
const QueueLineBadge: FC<{ text: string; className?: string }> = ({ text, className }) => {
  const labels = useAssistantLabels()
  const lines = countComposerLines(text)
  if (lines < 2) return null

  return (
    <span
      data-slot="message-queue-item-lines"
      className={cn(mono, 'shrink-0 tabular-nums', className)}>
      {labels.queueLines(lines)}
    </span>
  )
}

/**
 * 官方那条「正在运行」行：蓝点（外圈 `animate-ping`）+ 正文 + 右侧 `running` 标签。
 *
 * 只在使用方显式给 `runningText` 时出现 —— 线程里当前轮的用户消息已经在对话流里，
 * 输入框上方再摆一条同样的正文会被读成「消息重复了」。
 */
const MessageQueueRunningRow: FC<{ text: string; className?: string }> = ({ text, className }) => {
  const labels = useAssistantLabels()

  return (
    <div
      data-slot="message-queue-running"
      className={cn(
        'bg-background border-border/60 dark:bg-popover flex items-center gap-2.5 rounded-2xl border p-3',
        className
      )}>
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500/60 motion-reduce:hidden" />
        <span className="dark:bg-blue-400 relative inline-flex size-2 rounded-full bg-blue-500" />
      </span>
      <span className="text-foreground/90 min-w-0 flex-1 truncate text-sm">{text}</span>
      <span className={cn(mono, 'shrink-0')}>{labels.queueRunning}</span>
    </div>
  )
}

function defaultRenderText(text: string): ReactNode {
  return text
}

export { MessageQueue, MessageQueueRunningRow, QueueLineBadge, LIST_MAX_HEIGHT_CLASS, textOfParts }
export type { MessageQueueItemInfo, MessageQueueProps }
