/**
 * 思考折叠：对齐 Cursor / Copilot
 *
 * - **每段思考**：默认折叠成一行「思考中…」，点开才挂正文（展开后不被抢走）
 * - 展开后不被抢走：受控 open + `streaming` 只负责「跟随最新 token」
 *
 * 整轮的过程摘要（「已工作 4.8s」+ 时间线）已经搬到
 * `@cogito/design/assistant/run-activity`（见 `ThreadComponents.RunActivity`）：
 * 动过手的回合由它统一收成一条，这里的「一段思考」只在**没有工具调用**的回合
 * 还会出现（纯思考 → 回答）。
 */
import { useAuiState } from '@assistant-ui/react'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from '@cogito/design/assistant/reasoning.aui'
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
  // 默认折叠：思考正文不进布局，只留一行「思考中… / 已思考」状态。
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
      />
      <ReasoningContent aria-busy={isActive}>
        <ReasoningText>{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

export { AgentProcessGroup }
