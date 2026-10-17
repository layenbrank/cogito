import { cn } from 'cn'

import { formatUsageBytes } from '@/features/capture/model/usage'

interface UsageMeterProps {
  label: string
  used: number
  max: number
  count: number
  maxCount: number
  unitLabel: string
  className?: string
}

function findRatio(used: number, max: number): number {
  if (max <= 0) return used > 0 ? 1 : 0
  return Math.min(1, used / max)
}

/**
 * 紧凑占用条：容量 + 数量双轨，对齐工具窗密度。
 */
function UsageMeter(props: UsageMeterProps) {
  const sizeRatio = findRatio(props.used, props.max)
  const countRatio = findRatio(props.count, props.maxCount)
  const isHot = sizeRatio >= 0.85 || countRatio >= 0.85

  return (
    <div className={cn('min-w-0 space-y-1', props.className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs leading-none">
        <span className="truncate font-medium text-foreground">{props.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {props.count}/{props.maxCount}
          {props.unitLabel} · {formatUsageBytes(props.used)}/{formatUsageBytes(props.max)}
        </span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-200',
            isHot ? 'bg-warning' : 'bg-primary/70'
          )}
          style={{ width: `${Math.max(sizeRatio * 100, props.used > 0 ? 4 : 0)}%` }}
          title="容量占用"
        />
      </div>
      <div className="h-0.5 overflow-hidden rounded-full bg-muted/80">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-200',
            isHot ? 'bg-warning/80' : 'bg-primary/40'
          )}
          style={{ width: `${Math.max(countRatio * 100, props.count > 0 ? 4 : 0)}%` }}
          title="数量占用"
        />
      </div>
    </div>
  )
}

export { UsageMeter }
export type { UsageMeterProps }
