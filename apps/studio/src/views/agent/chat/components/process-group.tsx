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

import { formatDurationSeconds } from '@/features/agent/duration.ts'
import { useAgentStore } from '@/stores/agent.ts'

/**
 * 思考段的折叠条（覆盖 `ThreadComponents.ReasoningGroup`）。
 *
 * 「思考」段只是整轮过程里的一段（新会话里过程由 `AgentProcessFold` 兜住），
 * 所以这里不给秒数 —— 整轮的耗时算在外层那条上，贴到这里就等于同一段时间报两遍。
 * 「折叠回复过程」也由外层管：这里只按段自己的状态决定流式展开。
 */

interface ProcessGroupProps {
  group: ThreadGroupPart
}

export function AgentProcessGroup(props: PropsWithChildren<ProcessGroupProps>) {
  const labels = useAssistantLabels()
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

/**
 * 整轮过程摘要（覆盖 `ThreadComponents.ProcessGroup`）：
 * thread 仅在回合结束后包一层；流式中各段扁平自折。默认收起，偏好可展开。
 */

interface ProcessFoldProps {
  group: ThreadGroupPart
  running: boolean
}

export function AgentProcessFold(props: PropsWithChildren<ProcessFoldProps>) {
  const labels = useAssistantLabels()
  const collapseProcess = useAgentStore(function (state) {
    return state.settings.chat.collapseProcess
  })
  const durationFormat = useAgentStore(function (state) {
    return state.settings.chat.durationFormat
  })
  const totalStreamTime = useAuiState(function (state) {
    return state.message.metadata.timing?.totalStreamTime
  })

  const seconds =
    totalStreamTime === undefined
      ? undefined
      : formatDurationSeconds(totalStreamTime, durationFormat)

  return (
    <ReasoningRoot
      variant="ghost"
      defaultOpen={!collapseProcess}>
      <ReasoningTrigger
        active={false}
        label={labels.process(props.group.indices.length, seconds)}
      />
      <ReasoningContent>
        <ReasoningText>{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}
