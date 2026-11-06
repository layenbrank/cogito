/**
 * 内联计划 data part：ACP plan → assistant-ui `data` 部件。
 *
 * 渲染用 `elements/agent-plan`（标题 + `5 of 5` + 进度条 + 每步状态图标）：
 * ACP 给的是**每步三态**，换算成元素要的单个 `activeIndex` 走 `plan-steps.ts`
 * （右栏计划页签共用同一份换算）。
 *
 * 版本角标：这张卡的步骤和当前档案（`agent_plan`）对不上时，说明它已经被更新的
 * revision 取代 —— 不标出来，用户会以为对话里最后一张卡就是「最新计划」，照着旧版
 * 再点一次执行（这正是计划重复执行的来源之一）。
 */
import { Icon } from '@iconify/react/offline'
import { makeAssistantDataUI, useAuiState, type DataMessagePartProps } from '@assistant-ui/react'
import { PLAN_PART_NAME } from '@cogito/chat/adapters/chat-model'
import type { ChatPlanEntry } from '@cogito/chat/ports'
import { AgentPlan } from '@cogito/design/assistant/agent-plan'

import { usePlanRecord } from '@/features/agent/plan-store'

import { toActiveIndex, toPlanSteps } from './plan-steps'

interface ChatPlanPartData {
  entries: readonly ChatPlanEntry[]
}

function PlanPartRender(props: DataMessagePartProps<ChatPlanPartData>) {
  // assistant-ui 的 DataMessagePartProps<T> 与 MessagePartState 交叉后 data 退化为 any，这里收回类型
  const entries = (props.data as ChatPlanPartData).entries ?? []
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const record = usePlanRecord(threadID)

  if (entries.length === 0) return null

  // 步骤对不上当前档案 = 这张卡不是最新一版；`revision > 1` 才谈得上「被哪一版取代」
  const cardSteps = entries.map(function (entry) {
    return entry.content
  })
  const currentSteps = record?.steps ?? []
  const isCurrent =
    cardSteps.length === currentSteps.length &&
    cardSteps.every(function (step, index) {
      return step === currentSteps[index]
    })
  const supersededBy = record && record.revision > 1 && !isCurrent ? record.revision : null

  return (
    <div className="not-prose my-2">
      {supersededBy ? (
        <div className="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
          <Icon
            icon="lucide:archive"
            className="size-3 shrink-0"
          />
          <span>{`已被 r${supersededBy} 取代`}</span>
        </div>
      ) : null}
      <AgentPlan
        title="执行计划"
        steps={toPlanSteps(entries)}
        activeIndex={toActiveIndex(entries)}
        // 计划一长，对话里这张卡只负责「一眼看到进度」；全量清单在右栏计划页签
        collapseAfter={5}
        className="not-prose"
      />
    </div>
  )
}

const AgentPlanDataUI = makeAssistantDataUI({
  name: PLAN_PART_NAME,
  render: PlanPartRender
})

export { AgentPlanDataUI }
