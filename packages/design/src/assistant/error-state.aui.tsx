/**
 * assistant-ui「error state」元素（https://www.assistant-ui.com/elements/error-state）的
 * 本仓实现：失败的那一轮在原位留一条安静的红色提示 + 重试按钮，不做弹窗。
 *
 * 只实现「有 runtime」形态：`MessagePrimitive.Error` 只在消息带上错误时渲染 children，
 * 所以外面不用自己判 `status.reason === 'error'`。官方元素的「Retrying」子状态在
 * runtime 下没有落脚点 —— `aui.message.reload()` 会重新生成这条消息，错误态自己就消失了，
 * 没有可以停留的中间态，因此这里不伪造一个。
 */
import { ErrorPrimitive, MessagePrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import type { FC } from 'react'

import { useAssistantLabels } from './labels'

const MessageError: FC = function MessageError() {
  const labels = useAssistantLabels()
  const aui = useAui()
  // 重试即重新生成这条消息；线程正在跑时按钮不该可点
  const busy = useAuiState(function (state) {
    return state.thread.isRunning
  })

  return (
    <MessagePrimitive.Error>
      <div
        data-slot="error-state"
        role="alert"
        className="aui-message-error-root bg-destructive/[0.06] dark:bg-destructive/10 mt-2 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm">
        <Icon
          icon="lucide:circle-alert"
          className="text-destructive/80 mt-0.5 size-4 shrink-0"
        />
        <ErrorPrimitive.Message className="aui-message-error-message text-destructive dark:text-red-400 min-w-0 flex-1 whitespace-pre-wrap wrap-break-word" />
        <button
          type="button"
          data-slot="error-state-retry"
          disabled={busy}
          onClick={function () {
            aui.message.reload()
          }}
          className="text-destructive hover:bg-destructive/10 ms-auto flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50">
          <Icon
            icon="lucide:refresh-cw"
            className="size-3"
          />
          {labels.errorRetry}
        </button>
      </div>
    </MessagePrimitive.Error>
  )
}

export { MessageError }
