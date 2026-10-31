import { clsx } from 'clsx'
import type { FC } from 'react'

/** 轨迹瀑布图的一行：一条 span 在共享时间轴上的位置与宽度 */
interface TraceSpan {
  id: string
  name: string
  depth: number
  startMs: number
  durationMs: number
  status: 'running' | 'completed' | 'failed'
}

interface TraceWaterfallProps {
  spans: readonly TraceSpan[]
  totalMs: number
  visibleCount: number
  className?: string
}

const STATUS_BAR = {
  running: 'bg-primary/60 animate-pulse',
  completed: 'bg-success',
  failed: 'bg-destructive'
} as const

/**
 * 轨迹瀑布图：把一轮里的消息 / 工具 / 思考放在同一条时间轴上，一眼看出时间花在哪。
 * 纯展示；spans 由调用方从 message timing + part timing 投影（见 app 侧 `useMessageTrace`）。
 */
const TraceWaterfall: FC<TraceWaterfallProps> = function TraceWaterfall(props) {
  const total = props.totalMs > 0 ? props.totalMs : 1
  const visible = props.spans.slice(0, Math.max(0, props.visibleCount))

  return (
    <div
      data-slot="aui_trace-waterfall"
      className={clsx('flex flex-col gap-1', props.className)}>
      <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
        <span className="font-medium tracking-wide uppercase">轨迹</span>
        <span className="ml-auto font-mono tabular-nums">{props.totalMs} ms</span>
      </div>
      <div className="flex flex-col gap-1">
        {visible.map(function (span) {
          const left = (span.startMs / total) * 100
          const width = Math.max(1.5, (span.durationMs / total) * 100)
          return (
            <div key={span.id} className="flex items-center gap-2 px-1">
              <span
                className="text-foreground min-w-0 flex-1 truncate text-xs"
                style={{ paddingLeft: `${span.depth * 12}px` }}>
                {span.name}
              </span>
              <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                {span.durationMs} ms
              </span>
              <div className="bg-muted/50 relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full">
                <div
                  className={clsx('absolute inset-y-0 rounded-full', STATUS_BAR[span.status])}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { TraceWaterfall }
export type { TraceSpan, TraceWaterfallProps }
