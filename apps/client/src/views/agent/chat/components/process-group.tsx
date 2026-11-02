/**
 * 思考 / 过程折叠：对齐 Cursor / Copilot
 *
 * - **每段思考**：该段 part 结束即收起（不是整轮会话结束）
 * - **过程摘要**：整轮结束后才出现「过程 · N 步」，默认收起，点开回看
 *
 * 过程摘要：`instant` 跳过高度动画；**懒挂载**（对齐终端卡折叠不渲染正文），
 * 收起时不保留整棵工具/思考 DOM，多会话长回合省内存。
 *
 * ReasoningRoot：`streaming` 时展开；结束后回到 `defaultOpen`（默认 false）。
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

import { MessageTimingStats, MessageTrace } from './message-trace'

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
 * 仅在回合结束后由 thread 包一层；默认收起，首次展开再挂载子树。
 */
function AgentProcessFold(props: PropsWithChildren<ProcessFoldProps>) {
  const labels = useAssistantLabels()
  const totalStreamTime = useAuiState(function (state) {
    return state.message.metadata.timing?.totalStreamTime
  })
  const seconds =
    totalStreamTime === undefined ? undefined : Math.max(1, Math.round(totalStreamTime / 1000))
  const [isOpen, updateOpen] = useState(false)
  const [hasOpened, updateHasOpened] = useState(false)

  return (
    <ReasoningRoot
      variant="ghost"
      instant
      open={isOpen}
      onOpenChange={function (next) {
        updateOpen(next)
        if (next) updateHasOpened(true)
      }}>
      <ReasoningTrigger
        active={false}
        label={labels.process(props.group.indices.length, seconds)}
      />
      <ReasoningContent>
        {hasOpened ? (
          <>
            <MessageTimingStats />
            <MessageTrace />
            <ReasoningText
              data-slot="agent-process-fold"
              className="max-h-[min(70vh,40rem)] overflow-y-auto overscroll-y-contain">
              {props.children}
            </ReasoningText>
          </>
        ) : null}
      </ReasoningContent>
    </ReasoningRoot>
  )
}

export { AgentProcessGroup, AgentProcessFold }
