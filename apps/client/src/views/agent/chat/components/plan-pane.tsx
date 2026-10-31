/**
 * 右侧 Plan 面板：展示 goose 结构化计划（只读：条目状态由 goose 整份覆盖）。
 */
import { Icon } from '@iconify/react/offline'
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
import { Button } from '@cogito/design/components/button'

import styles from './plan-pane.module.scss'
import type { PlanSnapshot } from '@/features/agent/plan'

interface PlanPaneProps {
  className?: string
  plan: PlanSnapshot | null
  onClose: () => void
}

const STATUS_LABEL = {
  pending: '待办',
  in_progress: '进行中',
  completed: '完成'
} as const

function statusOf(status: string | undefined): keyof typeof STATUS_LABEL {
  if (status === 'in_progress' || status === 'completed') return status
  return 'pending'
}

function AgentPlanPane(props: PlanPaneProps) {
  const plan = props.plan
  const total = plan?.total ?? 0
  const done = plan?.done ?? 0

  return (
    <div className={props.className ?? styles.root}>
      <Plan
        defaultOpen
        className="not-prose h-full border-none shadow-none">
        <PlanHeader className="border-border border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <PlanTitle>计划</PlanTitle>
            <PlanDescription>
              {total > 0 ? `共 ${total} 步，已完成 ${done} 步` : '暂无进行中的计划'}
            </PlanDescription>
          </div>
          <PlanAction>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭计划面板"
              onClick={props.onClose}>
              <Icon icon="lucide:x" />
            </Button>
            <PlanTrigger />
          </PlanAction>
        </PlanHeader>
        <PlanContent className="px-4 py-3">
          {plan && plan.entries.length > 0 ? (
            <Task defaultOpen>
              <TaskTrigger title="计划步骤" />
              <TaskContent>
                <ol className="flex flex-col gap-2">
                  {plan.entries.map(function (entry) {
                    const status = statusOf(entry.status)
                    return (
                      <li
                        key={`${status}-${entry.content}`}
                        className="flex items-start gap-2">
                        <Badge
                          variant={
                            status === 'completed'
                              ? 'secondary'
                              : status === 'in_progress'
                                ? 'default'
                                : 'outline'
                          }
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
          ) : (
            <div className="text-muted-foreground px-0 py-8 text-center text-sm">暂无计划</div>
          )}
        </PlanContent>
      </Plan>
    </div>
  )
}

export { AgentPlanPane }
