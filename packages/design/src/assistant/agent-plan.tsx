/**
 * Agent plan（对齐 assistant-ui `elements/agent-plan`）
 *
 * 「模型正在按这份清单干活」的一张速览卡：标题 + `5 of 5` + 一条细进度条 +
 * 每步一个状态图标（对勾 / 转圈 / 圆点）。三态不是三份数据 ——
 * 只有 `activeIndex`：它之前的算完成、它自己算进行中、之后的算还没到。
 *
 * 与 `plan.tsx` / `todo-list.tsx` 的关系：
 * - `plan.tsx` 是可折叠的 Card 外壳（标题 / 描述 / 触发器），本元素**不折叠**；
 * - `todo-list.tsx` 吃的是每步自带 status 的三态清单（ACP `plan` 事件就是这个形状），
 *   本元素吃单个推进下标 —— 宿主拿三态数据时自己换算（client 的 plan data part 就是）。
 *
 * 元素本体是收费产物，结构 / 行为 / 无障碍属性按官网渲染出的 DOM 自写；
 * 字号走本仓档位（正文 `text-sm`、计数 `mono` 即 `text-xs`），不照搬 13.5px / 11px。
 *
 * **可选折叠壳**（`collapseAfter`，元素页没有这个能力）：步数一多，整段清单铺在
 * 消息里会把回答顶到屏幕外。给了 `collapseAfter` 且步数超过它时，默认只留
 * 「表头 + 进度条 + 正在做的那一行」，其余折起来 —— 对话里的卡只负责「一眼看到进度」，
 * 全量计划交给右栏的计划页签。不给这个 prop 时渲染与元素页逐字一致。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useId, useState } from 'react'

import {
  findPlanProgress,
  findStepStatus,
  formatPlanCount,
  toPlanSteps,
  type AgentPlanStep,
  type PlanStepStatus
} from './agent-plan-state'
import { ghostButton, mono } from './elements/surfaces'
import { useAssistantLabels } from './labels'

interface AgentPlanProps {
  /** 卡片标题；同时用作进度条的无障碍名称（不给就退回「计划进度」） */
  title?: string
  /** 步骤：字符串只带标签，对象可带 `id`（稳定 key）与 `description`（只在进行中那步显示） */
  steps: readonly (string | AgentPlanStep)[]
  /** 正在进行的那一步的下标；钳进 `0…steps.length`，等于长度表示全部完成 */
  activeIndex?: number
  /**
   * 计划还没开始（草稿 / 待执行）：所有步都是「还没到」，进度 0，没有转圈的那一行。
   * 元素页没有这个状态，是本仓给「右栏读草稿计划」补的。
   */
  idle?: boolean
  /**
   * 步数超过它就折起来（省略 = 永不折，与元素页一致）。
   * 折叠态只留表头 / 进度条 / 正在做的那一行，展开后是整份清单。
   */
  collapseAfter?: number
  /** 需要折叠时，初始是否直接展开 */
  defaultOpen?: boolean
  /** 跳过进度条宽度动画（一次铺开多张卡时用） */
  instant?: boolean
  className?: string
}

/** 一步的状态图标：做完是对勾，进行中是转圈，还没到是一个圆点 */
function StepStatusIcon(props: { status: PlanStepStatus }) {
  if (props.status === 'done') {
    return <Icon icon="lucide:check" aria-hidden className="text-muted-foreground size-3.5" />
  }
  if (props.status === 'active') {
    return (
      <Icon
        icon="lucide:loader-circle"
        aria-hidden
        className="text-foreground size-3.5 animate-spin motion-reduce:animate-none"
      />
    )
  }
  return <span aria-hidden className="bg-foreground/20 size-1.5 rounded-full" />
}

function AgentPlan({
  title,
  steps,
  activeIndex,
  idle = false,
  collapseAfter,
  defaultOpen = false,
  instant = false,
  className
}: AgentPlanProps) {
  const labels = useAssistantLabels()
  const items = toPlanSteps(steps)
  const progress = findPlanProgress(items.length, activeIndex, idle)
  const listId = useId()

  // 折叠是宿主点开的（collapseAfter 给了才算数）；步数没超就不出现开关
  const foldable = collapseAfter !== undefined && items.length > collapseAfter
  const [expanded, setExpanded] = useState(defaultOpen)
  const folded = foldable && !expanded

  const statusText: Record<PlanStepStatus, string> = {
    done: labels.planStepDone,
    active: labels.planStepActive,
    ahead: labels.planStepAhead
  }

  const rows = items.map(function (step, index) {
    return { step, index, status: findStepStatus(index, progress) }
  })
  // 折叠态只留「正在做」的那一行：全完成时没有 active，就只剩表头与进度条
  const visibleRows = folded
    ? rows.filter(function (row) {
        return row.status === 'active'
      })
    : rows

  return (
    <div
      data-slot="agent-plan"
      data-status={idle ? 'idle' : progress.allDone ? 'complete' : 'running'}
      data-folded={folded ? '' : undefined}
      className={cn('flex w-full max-w-sm flex-col gap-3', className)}>
      <div data-slot="agent-plan-header" className="flex items-center justify-between gap-3">
        {title ? <span className="text-sm font-medium">{title}</span> : null}
        <span
          data-slot="agent-plan-count"
          className={cn(mono, 'tabular-nums', !title && 'ms-auto')}>
          {formatPlanCount(progress, labels)}
        </span>
        {foldable ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={expanded ? labels.planCollapse : labels.planExpand(items.length)}
            onClick={function () {
              setExpanded(function (open) {
                return !open
              })
            }}
            className={cn(ghostButton, 'size-6 shrink-0')}>
            <Icon
              icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
              aria-hidden
              className="size-3.5"
            />
          </button>
        ) : null}
      </div>

      <div
        data-slot="agent-plan-progress"
        role="progressbar"
        aria-label={labels.planProgress(title)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={labels.planProgressValue(progress.completed, progress.total)}
        className="bg-foreground/[0.06] inset-ring-border inset-ring h-[3px] w-full overflow-hidden rounded-full">
        <span
          aria-hidden
          className={cn(
            'bg-foreground/80 block h-full rounded-full',
            // 进度条 500ms 是元素口径：比聊天里其它动效（220ms）慢，宽度变化才不显得抖
            'transition-[width] motion-reduce:transition-none',
            instant ? 'duration-0' : 'duration-500'
          )}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <ul id={listId} data-slot="agent-plan-steps" className="flex flex-col gap-2.5">
        {visibleRows.map(function (row) {
          const step = row.step
          const status = row.status
          return (
            <li
              key={step.id}
              data-slot="agent-plan-step"
              data-status={status}
              className="flex items-center gap-2.5 text-sm">
              <span className="flex size-4 shrink-0 items-center justify-center">
                <StepStatusIcon status={status} />
              </span>
              <span className="min-w-0">
                <span
                  className={status === 'active' ? 'text-foreground' : 'text-muted-foreground'}>
                  {step.label}
                </span>
                {status === 'active' && step.description ? (
                  <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                    {step.description}
                  </span>
                ) : null}
                <span className="sr-only">{` ${statusText[status]}`}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export { AgentPlan }
export type { AgentPlanProps }
