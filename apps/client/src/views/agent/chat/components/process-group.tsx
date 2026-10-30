/**
 * 思考 / 过程折叠：对齐 Cursor / Copilot
 *
 * - **每段思考**：该段 part 结束即收起（不是整轮会话结束）
 * - **过程摘要**：整轮结束后才出现「过程 · N 步」，默认收起，点开回看
 *
 * 过程摘要效率（关键）：
 * 1. `instant`：不做高度插值动画、不锁滚动（几十步总高上做 collapsible-down 必卡）
 * 2. 首次展开才把步骤树挂进 Panel；同一次事件里批量 setState，避免「空壳先开再灌内容」
 * 3. 展开过后 `keepMounted`：再开关只显隐，禁止每次全量 remount
 *
 * 滚动层级（保留 max-h 笼 + `overscroll-y-contain`）：
 * - Thread 视口：默认 overscroll，管整页对话
 * - 过程摘要 / 思考正文：max-h 自滚，触底不拖走 Thread
 * - 终端 / pre：内层再 contain，不链式带动外层笼
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

  const [isOpen, updateOpen] = useState(false)
  /** 是否已把步骤树挂进 Panel；一旦为 true 就保持，配合 keepMounted 避免反复 remount */
  const [hasMountedBody, updateHasMountedBody] = useState(false)

  function handleOpenChange(next: boolean) {
    if (next) {
      // 同事件批量更新：一次 commit 同时 open + 挂载，禁止先开空壳再灌内容
      if (!hasMountedBody) updateHasMountedBody(true)
      updateOpen(true)
      return
    }
    updateOpen(false)
  }

  return (
    <ReasoningRoot
      variant="ghost"
      instant
      open={isOpen}
      onOpenChange={handleOpenChange}>
      <ReasoningTrigger
        active={false}
        label={labels.process(props.group.indices.length, seconds)}
      />
      <ReasoningContent keepMounted={hasMountedBody}>
        <ReasoningText
          data-slot="agent-process-fold"
          className="max-h-[min(70vh,40rem)] overflow-y-auto overscroll-y-contain">
          {hasMountedBody ? props.children : null}
        </ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

export { AgentProcessGroup, AgentProcessFold }
