/**
 * assistant-ui「edit a sent message」元素（https://www.assistant-ui.com/elements/edit-message）的
 * 本仓实现。元素本体是收费产物，官网只给了示例块和 anatomy：这里照示例的版面重写视觉
 * （`field` 浅底表面 + `rounded-2xl p-3.5` 的编辑壳、右侧 Cancel / Send、正文下方那条
 * 「发送会丢弃 N 条回复」的提示），内在行为 —— 何时算进入编辑、丢弃条数怎么数、
 * 键盘与输入法怎么处理 —— 全部自己实现。
 *
 * 两种形态：
 * - `EditMessage`（standalone）：受控组件，`editing` / `value` / `discardedReplies` 由 app 持有，
 *   点击气泡进入编辑；
 * - `MessageEditComposer`（runtime）：挂在消息内，`ComposerPrimitive` 自动作用域到这条消息
 *   自己的 edit composer，丢弃条数从当前分支自己算，app 不用传。
 *
 * 与官方的一处口径差异：官方 runtime 版说「编辑不删除任何东西」，只是把改写作为同父的新分支，
 * 所以它把提示写成「会从视图里掉出去几条」。本仓沿用同一口径 —— `findDiscardedReplies`
 * 数的是**当前显示分支上这条消息之后的助手回复**，不是真的删库。
 */
import { ComposerPrimitive, MessagePrimitive, useAuiState, type AssistantState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, FC, KeyboardEvent, ReactNode } from 'react'

import { field, ghostButton } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 发送按钮与取消按钮共用的尺寸：官方示例是 `h-8 rounded-full px-3.5 text-xs` */
const ACTION_CLASS = 'h-8 shrink-0 rounded-full px-3.5 text-xs font-medium'

/** 输入框本体：无边框无底色，靠外层 `field` 面托住（字号走本仓 `text-sm`，与气泡一致） */
const INPUT_CLASS =
  'text-foreground placeholder:text-muted-foreground/70 w-full resize-none bg-transparent px-1 py-0.5 text-sm leading-6 outline-none'

/**
 * 「发送会丢弃 N 条回复」提示。`count <= 0` 不渲染（官方也是 >0 才出现）：
 * 改最后一条消息时没有后续回复可丢，再多一行提示就是噪音。
 */
const EditMessageDiscardNote: FC<{ count: number; className?: string }> = ({ count, className }) => {
  const labels = useAssistantLabels()

  if (count <= 0) return null

  return (
    <p
      data-slot="edit-message-discard"
      role="status"
      className={cn(
        'text-muted-foreground flex items-center gap-1.5 px-1 text-xs leading-5',
        className
      )}>
      <Icon
        icon="lucide:triangle-alert"
        className="text-warning size-3.5 shrink-0"
      />
      <span className="min-w-0">{labels.editDiscardsReplies(count)}</span>
    </p>
  )
}

type EditMessageProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** 编辑框里的文本（受控） */
  value: string
  /** 发送后会从当前分支上消失的回复条数，`0` 不显示提示 */
  discardedReplies: number
  /** 是否处于编辑态 */
  editing: boolean
  onValueChange?: ((value: string) => void) | undefined
  onStartEdit?: (() => void) | undefined
  onSave?: (() => void) | undefined
  onCancel?: (() => void) | undefined
  /** 非编辑态气泡里的内容；不传就显示 `value` */
  children?: ReactNode
}

/**
 * 受控的编辑气泡（standalone）：不依赖 assistant-ui runtime，
 * 状态全在调用方 —— `editing` 自己翻、`discardedReplies` 自己数。
 */
const EditMessage: FC<EditMessageProps> = function EditMessage({
  value,
  discardedReplies,
  editing,
  onValueChange,
  onStartEdit,
  onSave,
  onCancel,
  children,
  className,
  ...rest
}) {
  const labels = useAssistantLabels()

  if (!editing) {
    return (
      <div
        data-slot="edit-message"
        data-state="idle"
        className={cn('flex w-full flex-col items-end', className)}
        {...rest}>
        <button
          type="button"
          data-slot="edit-message-bubble"
          title={labels.edit}
          aria-label={labels.edit}
          onClick={onStartEdit}
          className={cn(
            field,
            'text-foreground max-w-full rounded-2xl px-3.5 py-2.5 text-left text-sm leading-6 transition-colors',
            onStartEdit ? 'hover:bg-foreground/[0.07] cursor-text' : 'cursor-default'
          )}>
          <span className="wrap-break-word whitespace-pre-wrap">{children ?? value}</span>
        </button>
      </div>
    )
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel?.()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    // 中文/日文输入法选词时按 Enter 是「确认候选」，不能当成发送
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    if (value.trim().length > 0) onSave?.()
  }

  return (
    <div
      data-slot="edit-message"
      data-state="editing"
      className={cn('flex w-full flex-col items-end', className)}
      {...rest}>
      <div
        className={cn(
          field,
          'animate-in fade-in fill-mode-both flex w-full flex-col gap-3 rounded-2xl p-3.5 duration-200'
        )}>
        <textarea
          data-slot="edit-message-input"
          value={value}
          rows={2}
          autoFocus
          aria-label={labels.messageInput}
          onChange={function (event) {
            onValueChange?.(event.target.value)
          }}
          onKeyDown={handleKeyDown}
          className={INPUT_CLASS}
        />
        <EditMessageDiscardNote count={discardedReplies} />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            data-slot="edit-message-cancel"
            onClick={onCancel}
            className={cn(ghostButton, ACTION_CLASS)}>
            {labels.cancel}
          </button>
          <button
            type="button"
            data-slot="edit-message-send"
            disabled={value.trim().length === 0}
            onClick={onSave}
            className={cn(
              ACTION_CLASS,
              'bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:pointer-events-none disabled:opacity-40'
            )}>
            {labels.update}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 当前分支上、这条消息之后还有几条助手回复会从视图里掉出去。
 *
 * 口径与官方一致：`s.message.index` 是这条消息在**当前显示分支**里的位置，
 * 之后的消息在改写后会退到别的分支（不删、可通过分支切换回看）。
 */
function findDiscardedReplies(state: AssistantState): number {
  const index = state.message.index
  if (typeof index !== 'number' || index < 0) return 0
  return state.thread.messages
    .slice(index + 1)
    .filter(function isAssistant(message) {
      return message.role === 'assistant'
    }).length
}

type MessageEditComposerProps = {
  className?: string
  /** 覆盖自动算出的丢弃条数（app 有更准的账时用） */
  discardedReplies?: number | undefined
  /** 输入框行数，默认 2 行 */
  rows?: number | undefined
}

/**
 * runtime 版：在 `MessagePrimitive.Root` 里渲染，替掉原来的用户气泡。
 *
 * `ComposerPrimitive.*` 在「正在编辑的消息」内部会自动指向这条消息自己的 edit composer，
 * 所以这里不需要（也不应该）碰线程级的 draft；Cancel 丢掉草稿回到气泡，
 * Send 把改写作为同父新分支发出去。
 */
const MessageEditComposer: FC<MessageEditComposerProps> = function MessageEditComposer({
  className,
  discardedReplies,
  rows = 2
}) {
  const labels = useAssistantLabels()
  const autoDiscarded = useAuiState(findDiscardedReplies)
  const count = discardedReplies ?? autoDiscarded

  return (
    <MessagePrimitive.Root
      data-slot="edit-message"
      data-state="editing"
      className={cn('aui_edit-composer-wrapper flex flex-col px-2', className)}>
      <ComposerPrimitive.Root
        className={cn(
          field,
          'aui-edit-composer-root animate-in fade-in fill-mode-both ms-auto flex w-full max-w-[min(100%,36rem)] cursor-text flex-col gap-3 rounded-2xl p-3.5 duration-200'
        )}>
        <ComposerPrimitive.Input
          data-slot="edit-message-input"
          rows={rows}
          autoFocus
          aria-label={labels.messageInput}
          className={cn(INPUT_CLASS, 'aui-edit-composer-input')}
        />
        <EditMessageDiscardNote count={count} />
        <div className="aui-edit-composer-footer flex items-center justify-end gap-2">
          <ComposerPrimitive.Cancel asChild>
            <button
              type="button"
              data-slot="edit-message-cancel"
              className={cn(ghostButton, ACTION_CLASS)}>
              {labels.cancel}
            </button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <button
              type="button"
              data-slot="edit-message-send"
              className={cn(
                ACTION_CLASS,
                'bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:pointer-events-none disabled:opacity-40'
              )}>
              {labels.update}
            </button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

export { EditMessage, EditMessageDiscardNote, MessageEditComposer, findDiscardedReplies }
export type { EditMessageProps, MessageEditComposerProps }
