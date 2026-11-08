/**
 * 思考折叠：一段一条，对齐 Cursor
 *
 * - **每段思考**各自折叠：默认收起成一行「思考中… / 已思考 · 最新一句」，点开才挂正文
 * - 展开后不被抢走：受控 open + `streaming` 只负责「跟随最新 token」
 *
 * 这里只是**子折叠**那层：整轮的总折叠是 `ThreadComponents.ProcessGroup`（默认 `DefaultProcessGroup`），
 * 收起它就把这些块整轮收成一行。每个块各自开合 —— 收起一段思考只收那一段。
 */
import { useAuiState } from '@assistant-ui/react'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from '@cogito/design/assistant/reasoning.aui'
import { toThinkingHint } from '@cogito/design/assistant/process-state'
import type { ThreadGroupPart } from '@cogito/design/assistant/thread.aui'
import { useState, type PropsWithChildren } from 'react'

interface ProcessGroupProps {
  group: ThreadGroupPart
}

/** 单段思考折叠（覆盖 `ThreadComponents.ReasoningGroup`） */
function AgentProcessGroup(props: PropsWithChildren<ProcessGroupProps>) {
  const labels = useAssistantLabels()
  // 以「本段」为准：只有本段还在跑才显示运行态（转圈 + shimmer）
  const isMessageRunning = useAuiState(function (state) {
    return state.message.status?.type === 'running'
  })
  const isActive = isMessageRunning && props.group.status.type === 'running'
  /**
   * 折叠行上的「在想什么」：取本段最后一个 reasoning part 的**最后一行**。
   * 光写「思考中…」等于没说 —— 收起状态用户只看得到这一行。
   */
  const hint = useAuiState(function (state) {
    const indices = props.group.indices
    for (let position = indices.length - 1; position >= 0; position -= 1) {
      const part = state.message.parts[indices[position]]
      if (part?.type !== 'reasoning') continue
      const found = toThinkingHint(part.text)
      if (found) return found
    }
    return undefined
  })
  // 默认折叠：思考正文不进布局，只留一行「思考中… / 已思考 · 最新一句」。
  // streaming 仍传下去，但它只负责「展开后跟随最新 token」，不再自动展开。
  const [isOpen, updateOpen] = useState(false)

  return (
    <ReasoningRoot
      variant="ghost"
      open={isOpen}
      onOpenChange={updateOpen}
      streaming={isActive}>
      <ReasoningTrigger
        active={isActive}
        className="w-full max-w-none"
        label={isActive ? labels.working : labels.reasoning()}
        detail={hint}
      />
      <ReasoningContent aria-busy={isActive}>
        <ReasoningText>{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

export { AgentProcessGroup }
