/**
 * Schedule card（对齐 assistant-ui `elements/schedule-card`）
 *
 * 一张「自己会重复跑」的卡：名称 + 周期 + 开关，下面是下次触发与最近几次的结果。
 * 元素页说得明白 —— 它**只是展示**：排期本体和「暂停意味着什么」都在宿主后端，
 * `onToggle` 只报告点击，开关的位置与底色完全由 `enabled` 驱动，请求成功后宿主自己翻。
 *
 * 结构（按元素页渲染出的 DOM）：
 * - 抬头：时钟图标块 + 名称 / 周期 + 右侧开关；
 * - `next` 药丸（`field` 表面）：开着显示 `nextRun`，关着显示「已暂停」并整行压暗；
 * - `recent runs`：每行 对勾/叉 + 时间 + `ok`/`failed`；空数组只留标题不留行。
 *
 * 与 `plan-schedule-card.aui.tsx` 的区别：那是计划里「定时执行」的可编辑写日历卡，
 * 这条是任务的只读概览（`data-slot` / 导出名都不带 `plan-` 前缀）。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { field, mono, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'

interface ScheduleRun {
  /** 行 key */
  id: string
  /** 行标签（时间），格式由宿主决定 */
  at: string
  /** 成功 / 失败：决定对勾或叉，以及右端的 `ok` / `failed` */
  ok: boolean
}

interface ScheduleCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 任务名（长名截断，完整名称交给 `title`） */
  name: string
  /** 周期的人话（`每天 09:00`）：等宽小字压在名称下面 */
  cadence: string
  /** 下次触发（`11-11 09:00`）；`enabled` 为 false 时不显示 */
  nextRun: string
  /** 开关状态：位置与底色都从这里来，点击不自己翻 */
  enabled: boolean
  /** 最近几次执行，顺序即传入顺序 */
  history: readonly ScheduleRun[]
  /** 只报告点击；宿主在请求成功后自己改 `enabled` */
  onToggle?: () => void
  className?: string
}

function ScheduleCard({
  name,
  cadence,
  nextRun,
  enabled,
  history,
  onToggle,
  className,
  ...props
}: ScheduleCardProps) {
  const labels = useAssistantLabels()

  return (
    <div
      data-slot="schedule-card"
      data-enabled={enabled ? '' : undefined}
      className={cn(paper, 'flex w-full flex-col gap-3 rounded-2xl p-4', className)}
      {...props}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="bg-foreground/[0.05] text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
          <Icon
            icon="lucide:clock"
            className="size-3.5"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            data-slot="schedule-card-name"
            title={name}
            className="truncate text-sm font-medium">
            {name}
          </span>
          <span
            data-slot="schedule-card-cadence"
            className={cn(mono, 'truncate')}>
            {cadence}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? labels.schedulePause(name) : labels.scheduleResume(name)}
          data-slot="schedule-card-switch"
          onClick={onToggle}
          className={cn(
            'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 outline-hidden transition-colors duration-200',
            'focus-visible:ring-foreground/20 focus-visible:ring-1 motion-reduce:transition-none',
            enabled ? 'bg-foreground/80' : 'bg-foreground/15'
          )}>
          <span
            aria-hidden
            className={cn(
              'bg-background size-4 rounded-full transition-transform duration-200 motion-reduce:transition-none',
              enabled ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      <div
        data-slot="schedule-card-next"
        data-state={enabled ? 'scheduled' : 'paused'}
        className={cn(
          field,
          'flex items-baseline gap-2 rounded-xl px-3 py-2',
          !enabled && 'opacity-60'
        )}>
        <span className={mono}>{labels.scheduleNext}</span>
        <span className="text-foreground/80 min-w-0 text-sm break-words">
          {enabled ? nextRun : labels.schedulePaused}
        </span>
      </div>

      <div
        data-slot="schedule-card-runs"
        className="flex flex-col gap-1">
        <span className={mono}>{labels.scheduleRecentRuns}</span>
        {history.map(function (run) {
          return (
            <div
              key={run.id}
              data-slot="schedule-card-run"
              data-state={run.ok ? 'ok' : 'failed'}
              className="flex items-baseline gap-2">
              <Icon
                icon={run.ok ? 'lucide:check' : 'lucide:x'}
                aria-hidden
                className={cn(
                  'size-3 shrink-0 translate-y-0.5',
                  run.ok ? 'text-success' : 'text-destructive'
                )}
              />
              <span className="text-foreground/60 min-w-0 flex-1 truncate text-xs">{run.at}</span>
              <span className={cn(mono, 'shrink-0')}>
                {run.ok ? labels.scheduleRunOk : labels.scheduleRunFailed}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ScheduleCard }
export type { ScheduleCardProps, ScheduleRun }
