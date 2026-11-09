/**
 * 状态胶囊：任务卡 / 详情抬头 / 执行记录共用一套配色。
 *
 * 走设计 token（primary / success / destructive / muted），与「详情」页签里
 * 计划状态徽标（`aside-plan` 的 `STATUS_META`）同一套语言，不再各自写一份 scss。
 */
import { clsx } from 'clsx'

import type { TaskBadgeTone } from './model'

const TONE_CLASS: Record<TaskBadgeTone, string> = {
  running: 'bg-primary/10 text-primary',
  ok: 'bg-success/10 text-success',
  fail: 'bg-destructive/10 text-destructive',
  off: 'bg-muted text-muted-foreground',
  idle: 'bg-muted text-muted-foreground'
}

interface TaskStatusPillProps {
  tone: TaskBadgeTone
  label: string
  className?: string
}

function TaskStatusPill(props: TaskStatusPillProps) {
  return (
    <span
      className={clsx(
        'inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[11px] font-medium whitespace-nowrap',
        TONE_CLASS[props.tone],
        props.className
      )}>
      {props.label}
    </span>
  )
}

export { TaskStatusPill }
export type { TaskStatusPillProps }
