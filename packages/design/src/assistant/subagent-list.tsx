/**
 * Subagent list（对齐 assistant-ui `elements/subagent-list`）
 *
 * 一次派发给多个子 agent 的罗列：每张卡一行「完成勾 / 转圈 + 名称 + 模型 + 进度条」，
 * 末尾可选一张「汇总」卡（还在跑，进度条只做 shimmer，没有完成态）。
 *
 * 数据契约与官网一致，全部由宿主给：
 * - `agents` 顺序即展示顺序；`completedCount` 从**队首**开始算完成（所以按完成顺序传）；
 * - `progress[i]` 是 0…100，缺失 / `NaN` 一律读 0；条宽与 `aria-valuenow` 同源；
 * - `showSummary` 只控制末尾卡的显隐 —— 元素并不知道汇总本身是否跑完。
 *
 * 进度条用 `role="progressbar"` 而不是纯装饰：读屏按卡名播报百分比，
 * 颜色之外还有数值可读（`role="list"` 让一组子 agent 成为一个有序整体）。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { mono, paper, rowEnter } from './elements/surfaces'

interface SubagentItem {
  name: string
  /** 子 agent 用的模型；空串表示未知（不渲染徽标） */
  model: string
}

interface SubagentListProps extends Omit<ComponentProps<'div'>, 'children'> {
  agents: readonly SubagentItem[]
  completedCount: number
  progress: readonly number[]
  showSummary: boolean
  summaryAgent: SubagentItem
}

function clampProgress(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function SubagentCard(props: {
  agent: SubagentItem
  value: number
  isDone: boolean
  isSummary?: boolean
}) {
  const label = props.isSummary ? '汇总中' : props.isDone ? '已完成' : '进行中'
  return (
    <div
      data-slot={props.isSummary ? 'subagent-summary' : 'subagent-card'}
      data-state={props.isSummary ? 'summary' : props.isDone ? 'done' : 'running'}
      className={cn(paper, rowEnter, 'flex flex-col gap-2 rounded-xl px-3 py-2.5')}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full',
            props.isDone ? 'bg-success/15 text-success' : 'text-muted-foreground'
          )}>
          <Icon
            icon={props.isDone ? 'lucide:check' : 'lucide:loader-2'}
            className={cn('size-3', props.isDone ? null : 'animate-spin motion-reduce:animate-none')}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{props.agent.name}</span>
        {props.agent.model ? (
          <span
            data-slot="subagent-model"
            className={cn(mono, 'shrink-0 rounded-full bg-foreground/6 px-1.5 py-0.5')}>
            {props.agent.model}
          </span>
        ) : null}
        <span className="sr-only">{label}</span>
      </div>
      <div
        role="progressbar"
        aria-label={props.agent.name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.isSummary ? undefined : props.value}
        className="bg-foreground/10 relative h-1 w-full overflow-hidden rounded-full">
        <span
          aria-hidden
          data-slot="subagent-progress"
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out',
            props.isSummary
              ? 'bg-foreground/25 w-1/3 animate-pulse motion-reduce:animate-none'
              : 'bg-primary'
          )}
          style={props.isSummary ? undefined : { width: `${props.value}%` }}
        />
      </div>
    </div>
  )
}

function SubagentList(props: SubagentListProps) {
  const { agents, completedCount, progress, showSummary, summaryAgent, className, ...rest } = props
  if (agents.length === 0 && !showSummary) return null
  const done = Math.min(Math.max(0, Math.trunc(completedCount)), agents.length)

  return (
    <div
      data-slot="subagent-list"
      data-count={agents.length}
      role="list"
      className={cn('flex w-full flex-col gap-1.5', className)}
      {...rest}>
      {agents.map(function (agent, index) {
        return (
          <div
            key={`${agent.name}-${index}`}
            role="listitem"
            className="contents">
            <SubagentCard
              agent={agent}
              isDone={index < done}
              value={clampProgress(progress[index])}
            />
          </div>
        )
      })}
      {showSummary ? <SubagentCard agent={summaryAgent} isDone={false} value={0} isSummary /> : null}
    </div>
  )
}

export { SubagentList }
export type { SubagentItem, SubagentListProps }
