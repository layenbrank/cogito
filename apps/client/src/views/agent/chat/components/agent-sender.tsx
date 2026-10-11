/**
 * AgentSender：contentEditable 输入区，通用触发 + IME，对齐 ant-design/x 结构
 * chip / mention 采用纯 DOM（参考 Cursor 输入框），避免 createRoot 竞态
 */
import { forwardRef, type ReactNode, type Ref } from 'react'

import styles from './agent-sender.module.scss'
import { AgentSenderImages } from './agent-sender-images'
import { useAgentSender, type AgentSenderHandle } from './use-agent-sender'
import type { TriggerMatch, TriggerRule } from './sender-trigger'
import type { FilePartData } from '@/features/agent/types'
import type { KeyboardEvent } from 'react'

interface AgentSenderProps {
  placeholder?: string
  loading?: boolean
  disabled?: boolean
  /** 浮层打开时拦截 Enter 发送，由父级置 true */
  blockSubmit?: boolean
  autoSize?: { minRows?: number; maxRows?: number }
  /** 图像附件：输入框上方缩略图 + 等宽文件名 */
  images?: FilePartData[]
  footer?: ReactNode
  triggers?: TriggerRule[]
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  onRemoveImage?: (path: string) => void
  /** 粘贴图片文件（由父级落盘并加入附件） */
  onPasteImages?: (files: File[]) => void
  onTriggerChange?: (match: TriggerMatch | null) => void
  /** 键盘导航浮层：ArrowUp/Down/Enter 由父级处理时返回 true */
  onTriggerKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => boolean
}

function AgentSenderInner(props: AgentSenderProps, ref: Ref<AgentSenderHandle>) {
  const minRows = props.autoSize?.minRows ?? 1
  const maxRows = props.autoSize?.maxRows ?? 6
  const sender = useAgentSender({
    ref,
    triggers: props.triggers,
    minRows,
    maxRows,
    loading: props.loading,
    blockSubmit: props.blockSubmit,
    disabled: props.disabled,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onPasteImages: props.onPasteImages,
    onTriggerChange: props.onTriggerChange,
    onTriggerKeyDown: props.onTriggerKeyDown
  })

  return (
    <div
      className={styles.main}
      data-disabled={props.disabled ? 'true' : undefined}
      data-loading={props.loading ? 'true' : undefined}>
      {props.images ? (
        <AgentSenderImages
          images={props.images}
          disabled={props.disabled}
          onRemoveImage={props.onRemoveImage}
        />
      ) : null}
      <div className={styles.content}>
        <div
          ref={sender.editableRef}
          className={styles.input}
          contentEditable={!props.disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-label={props.placeholder || '消息输入'}
          aria-multiline
          data-placeholder={props.placeholder || ''}
          data-empty="true"
          onInput={sender.handleInput}
          onCompositionStart={sender.handleCompositionStart}
          onCompositionEnd={sender.handleCompositionEnd}
          onKeyDown={sender.handleKeyDown}
          onPaste={sender.handlePaste}
          onClick={sender.handleClick}
          onMouseDown={sender.handleMouseDown}
        />
      </div>
      {props.footer ? <div className={styles.footer}>{props.footer}</div> : null}
    </div>
  )
}

const AgentSender = forwardRef(AgentSenderInner)
AgentSender.displayName = 'AgentSender'

export { AgentSender }
export type { AgentSenderHandle, AgentSenderProps }
