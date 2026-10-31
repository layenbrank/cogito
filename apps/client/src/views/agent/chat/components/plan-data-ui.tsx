/**
 * 内联计划 data part：ACP plan → assistant-ui `data` 部件。
 */
import { makeAssistantDataUI, useAuiState, type DataMessagePartProps } from '@assistant-ui/react'
import { PLAN_PART_NAME } from '@cogito/chat/adapters/chat-model'
import type { ChatPlanEntry } from '@cogito/chat/ports'
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger
} from '@cogito/design/assistant/plan'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@cogito/design/assistant/task'
import { Badge } from '@cogito/design/components/badge'

interface ChatPlanPartData {
  entries: readonly ChatPlanEntry[]
}

const STATUS_LABEL = {
  pending: '待办',
  in_progress: '进行中',
  completed: '完成'
} as const

function statusOf(status: ChatPlanEntry['status']): keyof typeof STATUS_LABEL {
  if (status === 'in_progress' || status === 'completed') return status
  return 'pending'
}

function PlanPartRender(props: DataMessagePartProps<ChatPlanPartData>) {
  const isRunning = useAuiState(function (state) {
    return state.message.status?.type === 'running'
  })
  // assistant-ui 的 DataMessagePartProps<T> 与 MessagePartState 交叉后 data 退化为 any，这里收回类型
  const entries = (props.data as ChatPlanPartData).entries ?? []
  if (entries.length === 0) return null

  const done = entries.filter(function (entry: ChatPlanEntry) {
    return entry.status === 'completed'
  }).length

  return (
    <Plan
      isStreaming={isRunning}
      defaultOpen
      className="not-prose my-2">
      <PlanHeader>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <PlanTitle>执行计划</PlanTitle>
          <PlanDescription>{`共 ${entries.length} 步，已完成 ${done} 步`}</PlanDescription>
        </div>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>
      <PlanContent>
        <Task defaultOpen>
          <TaskTrigger title="计划步骤" />
          <TaskContent>
            <ol className="flex flex-col gap-2">
              {entries.map(function (entry: ChatPlanEntry) {
                const status = statusOf(entry.status)
                return (
                  <li
                    key={`${entry.status ?? 'pending'}:${entry.content}`}
                    className="flex items-start gap-2">
                    <Badge
                      variant={status === 'completed' ? 'secondary' : 'outline'}
                      className="mt-0.5 h-5 shrink-0 rounded-full px-2 text-xs">
                      {STATUS_LABEL[status]}
                    </Badge>
                    <TaskItem
                      className={
                        status === 'completed' ? 'text-muted-foreground line-through' : undefined
                      }>
                      {entry.content}
                    </TaskItem>
                  </li>
                )
              })}
            </ol>
          </TaskContent>
        </Task>
      </PlanContent>
    </Plan>
  )
}

const AgentPlanDataUI = makeAssistantDataUI({
  name: PLAN_PART_NAME,
  render: PlanPartRender
})

export { AgentPlanDataUI }
