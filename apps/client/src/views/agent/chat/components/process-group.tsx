/**
 * 思考 / 过程折叠：对齐 Cursor / Copilot
 *
 * - **每段思考**：该段 part 结束即收起（不是整轮会话结束）
 * - **过程摘要**：整轮结束后才出现「过程 · N 步」，默认收起，点开回看
 *
 * ReasoningRoot：`streaming` 时展开；结束后回到 `defaultOpen`（默认 false）。
 */
import { useAuiState } from '@assistant-ui/react'
import { useAssistantLabels } from '@i-thinking/design/assistant/labels'
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from '@i-thinking/design/assistant/reasoning.aui'
import type { ThreadGroupPart } from '@i-thinking/design/assistant/thread.aui'
import type { PropsWithChildren } from 'react'

interface ProcessGroupProps {
  group: ThreadGroupPart
}

/** 单段思考折叠（覆盖 `ThreadComponents.ReasoningGroup`） */
function AgentProcessGroup(props: PropsWithChildren<ProcessGroupProps>) {
  const labels = useAssistantLabels()
  // 以「本段」为准：消息已结束或本段不再 running → 立刻收起
  const isMessageRunning = useAuiState(function (state) {
    return state.message.status?.type === 'running'
  })
  const isActive = isMessageRunning && props.group.status.type === 'running'

  return (
    <ReasoningRoot
      variant="ghost"
      streaming={isActive}>
      <ReasoningTrigger
        active={isActive}
        label={isActive ? labels.working : labels.reasoning()}
      />
      <ReasoningContent aria-busy={isActive}>
        <ReasoningText>{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

interface ProcessFoldProps {
  group: ThreadGroupPart
  running: boolean
}

/**
 * 整轮过程摘要（覆盖 `ThreadComponents.ProcessGroup`）：
 * 仅在回合结束后由 thread 包一层；默认收起，不跟整轮 streaming 强行展开。
 */
function AgentProcessFold(props: PropsWithChildren<ProcessFoldProps>) {
  const labels = useAssistantLabels()
  const totalStreamTime = useAuiState(function (state) {
    return state.message.metadata.timing?.totalStreamTime
  })
  const seconds =
    totalStreamTime === undefined ? undefined : Math.max(1, Math.round(totalStreamTime / 1000))

  return (
    <ReasoningRoot
      variant="ghost"
      defaultOpen={false}>
      <ReasoningTrigger
        active={false}
        label={labels.process(props.group.indices.length, seconds)}
      />
      <ReasoningContent>
        <ReasoningText className="max-h-[min(70vh,40rem)]">{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

export { AgentProcessGroup, AgentProcessFold }
