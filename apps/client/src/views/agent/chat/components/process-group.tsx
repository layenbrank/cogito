/**
 * 思考 / 过程折叠条（对齐 studio）：流式时展开 + shimmer，结束后可收起。
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
  const isActive = props.group.status.type === 'running'

  return (
    <ReasoningRoot
      streaming={isActive}
      defaultOpen>
      <ReasoningTrigger active={isActive} />
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
 * 整轮过程折叠（覆盖 `ThreadComponents.ProcessGroup`）：
 * 思考 / 工具 / 中间解说收在里面，最终回答留在外面。
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
      streaming={props.running}
      defaultOpen>
      <ReasoningTrigger
        active={props.running}
        label={labels.process(props.group.indices.length, seconds)}
      />
      <ReasoningContent aria-busy={props.running}>
        {/* 过程区含工具终端：默认 max-h-64 太矮，抬到视口比例便于扫一眼输出 */}
        <ReasoningText className="max-h-[min(70vh,40rem)]">{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

export { AgentProcessGroup, AgentProcessFold }
