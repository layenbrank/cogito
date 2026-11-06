/**
 * 内联计划 data part：ACP plan → assistant-ui `data` 部件。
 *
 * 渲染用 `elements/agent-plan`（标题 + `5 of 5` + 进度条 + 每步状态图标）：
 * ACP 给的是**每步三态**，换算成元素要的单个 `activeIndex` 走 `plan-steps.ts`
 * （右栏计划页签共用同一份换算）。
 */
import { makeAssistantDataUI, type DataMessagePartProps } from '@assistant-ui/react'
import { PLAN_PART_NAME } from '@cogito/chat/adapters/chat-model'
import type { ChatPlanEntry } from '@cogito/chat/ports'
import { AgentPlan } from '@cogito/design/assistant/agent-plan'

import { toActiveIndex, toPlanSteps } from './plan-steps'

interface ChatPlanPartData {
  entries: readonly ChatPlanEntry[]
}

function PlanPartRender(props: DataMessagePartProps<ChatPlanPartData>) {
  // assistant-ui 的 DataMessagePartProps<T> 与 MessagePartState 交叉后 data 退化为 any，这里收回类型
  const entries = (props.data as ChatPlanPartData).entries ?? []
  if (entries.length === 0) return null

  return (
    <AgentPlan
      title="执行计划"
      steps={toPlanSteps(entries)}
      activeIndex={toActiveIndex(entries)}
      // 计划一长，对话里这张卡只负责「一眼看到进度」；全量清单在右栏计划页签
      collapseAfter={5}
      className="not-prose my-2"
    />
  )
}

const AgentPlanDataUI = makeAssistantDataUI({
  name: PLAN_PART_NAME,
  render: PlanPartRender
})

export { AgentPlanDataUI }
