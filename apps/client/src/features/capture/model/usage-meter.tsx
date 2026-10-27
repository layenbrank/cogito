import { AreaSparkline, type ChartPoint } from '@cogito/design/components/charts'
import { cn } from 'cn'

import { formatUsageBytes } from '@/features/capture/model/usage'

interface UsageMeterProps {
  label: string
  used: number
  max: number
  count: number
  maxCount: number
  unitLabel: string
  /** 近窗每日占用（MB）；有数据时用面积趋势图替代进度条 */
  points?: ChartPoint[]
  className?: string
}

function findRatio(used: number, max: number): number {
  if (max <= 0) return used > 0 ? 1 : 0
  return Math.min(1, used / max)
}

/**
 * 捕获占用条：容量/数量摘要 + 近窗占用趋势（共享 AreaSparkline）。
 */
function UsageMeter(props: UsageMeterProps) {
  const sizeRatio = findRatio(props.used, props.max)
  const countRatio = findRatio(props.count, props.maxCount)
  const isHot = sizeRatio >= 0.85 || countRatio >= 0.85
  const points = props.points ?? []
  const hasTrend = points.some(function (point) {
    return point.value > 0
  })

  return (
    <div className={cn('min-w-0 space-y-1', props.className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs leading-none">
        <span className="truncate font-medium text-foreground">{props.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {props.count}/{props.maxCount}
          {props.unitLabel} · {formatUsageBytes(props.used)}/{formatUsageBytes(props.max)}
        </span>
      </div>
      <AreaSparkline
        points={hasTrend ? points : []}
        height={28}
        color={isHot ? 'var(--warning)' : undefined}
        emptyHint="暂无占用"
      />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span title="容量占用">{Math.round(sizeRatio * 100)}% 容量</span>
        <span title="数量占用">
          {Math.round(countRatio * 100)}% 数量
        </span>
      </div>
    </div>
  )
}

export { UsageMeter }
export type { UsageMeterProps }
