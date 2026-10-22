import { useId } from 'react'

interface ChartPoint {
  label: string
  value: number
}

interface MiniBarChartProps {
  points: ChartPoint[]
  /** 柱色，默认 backend accent */
  color?: string
  /** 图表区高度（不含轴标签），默认 36 */
  height?: number
  emptyHint?: string
  /** 是否显示底部刻度；紧凑模式默认 false */
  showLabels?: boolean
}

interface MiniAreaChartProps {
  points: ChartPoint[]
  color?: string
  height?: number
  emptyHint?: string
  showLabels?: boolean
  /** 同页多个面积图时区分渐变 id */
  gradientId?: string
}

function findMax(points: ChartPoint[]) {
  return Math.max(
    ...points.map(function (point) {
      return point.value
    }),
    1
  )
}

function MiniBarChart(props: MiniBarChartProps) {
  const height = props.height ?? 36
  const color = props.color ?? 'var(--backend-accent)'
  const showLabels = props.showLabels ?? false
  if (props.points.length === 0) {
    return (
      <p className="py-2 text-center text-[11px] text-muted-foreground">
        {props.emptyHint ?? '暂无数据'}
      </p>
    )
  }
  const max = findMax(props.points)
  const lastIndex = props.points.length - 1
  return (
    <div>
      <div
        className="flex items-end gap-px"
        style={{ height }}
        role="img"
        aria-label="柱状图">
        {props.points.map(function (point) {
          const ratio = point.value / max
          const barHeight = Math.max(ratio * 100, point.value > 0 ? 12 : 4)
          return (
            <div
              key={point.label}
              className="flex min-w-0 flex-1 items-end justify-center"
              style={{ height: '100%' }}
              title={`${point.label}: ${point.value.toLocaleString()}`}>
              <div
                className="w-full max-w-[0.5rem] rounded-[2px] transition-opacity hover:opacity-90"
                style={{
                  height: `${barHeight}%`,
                  background: color,
                  opacity: point.value > 0 ? 0.85 : 0.18
                }}
              />
            </div>
          )
        })}
      </div>
      {showLabels ? (
        <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{props.points[0]?.label}</span>
          <span>{props.points[lastIndex]?.label}</span>
        </div>
      ) : null}
    </div>
  )
}

function MiniAreaChart(props: MiniAreaChartProps) {
  const height = props.height ?? 36
  const color = props.color ?? 'var(--backend-accent)'
  const showLabels = props.showLabels ?? false
  const autoId = useId().replace(/:/g, '')
  const gradientId = props.gradientId ?? `mini-area-${autoId}`
  if (props.points.length === 0) {
    return (
      <p className="py-2 text-center text-[11px] text-muted-foreground">
        {props.emptyHint ?? '暂无数据'}
      </p>
    )
  }
  const max = findMax(props.points)
  const width = 100
  const padY = 2
  const usable = height - padY * 2
  const step = props.points.length <= 1 ? 0 : width / (props.points.length - 1)
  const coords = props.points.map(function (point, index) {
    const x = index * step
    const y = padY + usable * (1 - point.value / max)
    return { x, y, point }
  })
  const line = coords
    .map(function (coord, index) {
      return `${index === 0 ? 'M' : 'L'}${coord.x},${coord.y}`
    })
    .join(' ')
  const last = coords[coords.length - 1]
  const area = `${line} L${last.x},${height} L0,${height} Z`

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height, width: '100%' }}
        className="block w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="趋势图">
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="0"
            y2="1">
            <stop
              offset="0%"
              stopColor={color}
              stopOpacity="0.3"
            />
            <stop
              offset="100%"
              stopColor={color}
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>
        <path
          d={area}
          fill={`url(#${gradientId})`}
        />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {showLabels ? (
        <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{props.points[0]?.label}</span>
          <span>{props.points[props.points.length - 1]?.label}</span>
        </div>
      ) : null}
    </div>
  )
}

export { MiniAreaChart, MiniBarChart }
export type { ChartPoint }
