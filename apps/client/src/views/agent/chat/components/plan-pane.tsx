/**
 * 右侧 Plan 面板：展示 goose 结构化计划（只读：条目状态由 goose 整份覆盖）。
 */
import { Icon } from '@iconify/react/offline'
import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { clsx } from 'clsx'

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

  return (
    <div className={props.className ?? styles.root}>
      <div className={`${styles.header} flex items-center justify-between`}>
        <span className="text-sm font-medium">
          计划
          {plan && plan.total > 0 ? `（${plan.done}/${plan.total}）` : ''}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭计划面板"
          onClick={props.onClose}>
          <Icon icon="lucide:x" />
        </Button>
      </div>
      <div className={styles.body}>
        {plan && plan.entries.length > 0 ? (
          <ol className="flex flex-col gap-1.5">
            {plan.entries.map(function (entry) {
              const status = statusOf(entry.status)
              return (
                <li
                  key={`${status}-${entry.content}`}
                  className="flex items-start gap-2">
                  <Badge
                    variant={status === 'completed' ? 'secondary' : status === 'in_progress' ? 'default' : 'outline'}
                    className="mt-0.5 shrink-0">
                    {STATUS_LABEL[status]}
                  </Badge>
                  <span
                    className={clsx(
                      'text-sm',
                      status === 'completed' && 'text-muted-foreground line-through'
                    )}>
                    {entry.content}
                  </span>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="text-muted-foreground px-4 py-12 text-center text-sm">
            代理规划出执行步骤后会显示在这里
          </div>
        )}
      </div>
    </div>
  )
}

export { AgentPlanPane }
