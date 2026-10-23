import {
  arc as d3Arc,
  axisBottom,
  axisLeft,
  easeCubicOut,
  line as d3Line,
  max as d3Max,
  pie as d3Pie,
  pointer,
  scaleBand,
  scaleLinear,
  select,
  sum as d3Sum,
  type PieArcDatum
} from 'd3'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { findChartTheme, type ChartPoint } from '@/components/console/chart.ts'

const CHART_HEIGHT = 240
const MARGIN = { top: 16, right: 12, bottom: 28, left: 40 }
const BAR_MARGIN = { top: 12, right: 16, bottom: 20, left: 96 }
const TOOLTIP_OFFSET = 12
const TOOLTIP_EDGE = 8
/** hover 动效时长（毫秒），克制在 150–250ms */
const MOTION_MS = 180
const TOOLTIP_MOTION_S = MOTION_MS / 1000

interface NamedCount {
  name: string
  value: number
}

interface EmptyableChartProps {
  height?: number
  isEmpty?: boolean
  emptyHint?: string
  className?: string
}

interface LineChartProps extends EmptyableChartProps {
  points: ChartPoint[]
}

interface BarChartProps extends EmptyableChartProps {
  items: NamedCount[]
}

interface PieChartProps extends EmptyableChartProps {
  items: NamedCount[]
}

interface ChartTooltipState {
  /** 生成该浮层时的数据/尺寸指纹：数据一变，旧浮层就不再渲染（避免 effect 里 setState）。 */
  dataKey: string
  left: number
  top: number
  label: string
  value: string
}

function EmptyHint(props: { height: number; hint: string }) {
  return (
    <p
      className="flex items-center justify-center text-xs text-muted-foreground"
      style={{ height: props.height }}>
      {props.hint}
    </p>
  )
}

/** shadcn 风格跟随指针浮层，opacity / 位移带短过渡 */
function ChartTooltip(props: ChartTooltipState) {
  const isReduced = useReducedMotion()
  const duration = isReduced ? 0 : TOOLTIP_MOTION_S
  const followDuration = isReduced ? 0 : 0.16

  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 z-10 max-w-[220px] rounded-md border border-border/80 bg-popover/95 px-2.5 py-1.5 text-xs text-popover-foreground shadow-md backdrop-blur-sm"
      initial={{ opacity: 0, scale: 0.98, x: props.left, y: props.top }}
      animate={{ opacity: 1, scale: 1, x: props.left, y: props.top }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{
        opacity: { duration, ease: 'easeOut' },
        scale: { duration, ease: 'easeOut' },
        x: { duration: followDuration, ease: 'easeOut' },
        y: { duration: followDuration, ease: 'easeOut' }
      }}
      role="tooltip">
      <div className="font-medium text-foreground">{props.label}</div>
      <div className="mt-0.5 tabular-nums text-muted-foreground">{props.value}</div>
    </motion.div>
  )
}

function ChartTooltipLayer(props: { tooltip: ChartTooltipState | null; dataKey: string }) {
  // 浮层属于某一份数据：数据/尺寸变了旧坐标就失效，直接不渲染。
  // 在渲染期判断而不是在 effect 里 setState(null)——后者会触发级联渲染（react-hooks/set-state-in-effect）。
  const tooltip =
    props.tooltip && props.tooltip.dataKey === props.dataKey ? props.tooltip : null
  return (
    <AnimatePresence>
      {tooltip ? (
        <ChartTooltip
          key="chart-tooltip"
          {...tooltip}
        />
      ) : null}
    </AnimatePresence>
  )
}

function clearSvg(host: SVGSVGElement) {
  select(host).selectAll('*').remove()
}

function formatCount(value: number) {
  return value.toLocaleString()
}

/** reduced-motion 时时长为 0，否则用克制的 hover 时长 */
function hoverMs(isReduced: boolean) {
  return isReduced ? 0 : MOTION_MS
}

/** 将浮层锚在指针旁，并限制在宿主矩形内 */
function placeTooltip(args: {
  dataKey: string
  host: HTMLElement
  clientX: number
  clientY: number
  label: string
  value: string
}): ChartTooltipState {
  const rect = args.host.getBoundingClientRect()
  const localX = args.clientX - rect.left
  const localY = args.clientY - rect.top
  const preferRight = localX + TOOLTIP_OFFSET + 140 < rect.width
  const preferBelow = localY + TOOLTIP_OFFSET + 48 < rect.height
  const left = preferRight
    ? localX + TOOLTIP_OFFSET
    : Math.max(TOOLTIP_EDGE, localX - TOOLTIP_OFFSET - 120)
  const top = preferBelow
    ? localY + TOOLTIP_OFFSET
    : Math.max(TOOLTIP_EDGE, localY - TOOLTIP_OFFSET - 40)
  return {
    dataKey: args.dataKey,
    left: Math.min(left, Math.max(TOOLTIP_EDGE, rect.width - 140)),
    top: Math.min(top, Math.max(TOOLTIP_EDGE, rect.height - 44)),
    label: args.label,
    value: args.value
  }
}

/** 监听宿主宽度变化并触发重绘 */
function useSvgWidth(svgRef: RefObject<SVGSVGElement | null>) {
  const [width, updateWidth] = useState(0)

  useEffect(
    function () {
      const svgEl = svgRef.current
      if (!svgEl) return
      function measure() {
        const node = svgRef.current
        if (!node) return
        updateWidth(node.clientWidth || node.parentElement?.clientWidth || 320)
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(svgEl.parentElement ?? svgEl)
      return function () {
        observer.disconnect()
      }
    },
    [svgRef]
  )

  return width
}

function LineChart(props: LineChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [tooltip, updateTooltip] = useState<ChartTooltipState | null>(null)
  const isReduced = useReducedMotion() === true
  const height = props.height ?? CHART_HEIGHT
  const width = useSvgWidth(svgRef)
  const dataKey = JSON.stringify(props)

  useEffect(
    function () {
      const svgEl = svgRef.current
      const hostEl = hostRef.current
      if (!svgEl || !hostEl || props.isEmpty || props.points.length === 0 || width <= 0) return

      const theme = findChartTheme()
      const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 1)
      const innerHeight = Math.max(height - MARGIN.top - MARGIN.bottom, 1)
      const first = props.points[0]
      const last = props.points[props.points.length - 1]
      if (!first || !last) return

      clearSvg(svgEl)
      const root = select(svgEl)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%')
        .attr('height', height)

      const g = root
        .append('g')
        .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

      const x = scaleBand()
        .domain(
          props.points.map(function (point) {
            return point.label
          })
        )
        .range([0, innerWidth])
        .padding(0.2)

      const yMax = d3Max(props.points, function (point) {
        return point.value
      })
      const y = scaleLinear()
        .domain([0, Math.max(yMax ?? 0, 1)])
        .nice()
        .range([innerHeight, 0])

      const tickLabels =
        props.points.length <= 7
          ? props.points.map(function (point) {
              return point.label
            })
          : [first.label, last.label]

      g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(axisBottom(x).tickSize(0).tickPadding(8).tickValues(tickLabels))
        .call(function (axis) {
          axis.select('.domain').attr('stroke', theme.border)
          axis.selectAll('text').attr('fill', theme.muted).attr('font-size', 10)
        })

      g.append('g')
        .call(axisLeft(y).ticks(4).tickSize(-innerWidth).tickPadding(6))
        .call(function (axis) {
          axis.select('.domain').remove()
          axis.selectAll('line').attr('stroke', theme.border).attr('stroke-dasharray', '3 3')
          axis.selectAll('text').attr('fill', theme.muted).attr('font-size', 10)
        })

      const lineGen = d3Line<ChartPoint>()
        .x(function (point) {
          return (x(point.label) ?? 0) + x.bandwidth() / 2
        })
        .y(function (point) {
          return y(point.value)
        })

      const linePath = lineGen(props.points)
      if (!linePath) return

      const areaD = `${linePath} L${(x(last.label) ?? 0) + x.bandwidth() / 2},${innerHeight} L${
        (x(first.label) ?? 0) + x.bandwidth() / 2
      },${innerHeight} Z`

      g.append('path').attr('d', areaD).attr('fill', theme.accent).attr('opacity', 0.16)
      g.append('path')
        .attr('d', linePath)
        .attr('fill', 'none')
        .attr('stroke', theme.accent)
        .attr('stroke-width', 1.75)

      const dots = g
        .selectAll('circle.point')
        .data(props.points)
        .join('circle')
        .attr('class', 'point')
        .attr('cx', function (point) {
          return (x(point.label) ?? 0) + x.bandwidth() / 2
        })
        .attr('cy', function (point) {
          return y(point.value)
        })
        .attr('r', 3)
        .attr('fill', theme.accent)
        .attr('opacity', 0.85)

      const focus = g.append('g').attr('class', 'focus').attr('opacity', 0)
      const focusLine = focus
        .append('line')
        .attr('class', 'focus-x')
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', theme.muted)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 3')
        .attr('opacity', 0.55)
      const focusDot = focus
        .append('circle')
        .attr('r', 5)
        .attr('fill', theme.surface)
        .attr('stroke', theme.accent)
        .attr('stroke-width', 2)

      const bandCenters = props.points.map(function (point) {
        return (x(point.label) ?? 0) + x.bandwidth() / 2
      })

      let activeIndex = -1
      let isFocusVisible = false

      function findNearestIndex(mouseX: number) {
        let nearest = 0
        let best = Number.POSITIVE_INFINITY
        for (let i = 0; i < bandCenters.length; i += 1) {
          const center = bandCenters[i] ?? 0
          const dist = Math.abs(center - mouseX)
          if (dist < best) {
            best = dist
            nearest = i
          }
        }
        return nearest
      }

      function hideFocus() {
        activeIndex = -1
        isFocusVisible = false
        focus.transition().duration(hoverMs(isReduced)).ease(easeCubicOut).attr('opacity', 0)
        dots
          .transition()
          .duration(hoverMs(isReduced))
          .ease(easeCubicOut)
          .attr('opacity', 0.85)
          .attr('r', 3)
        updateTooltip(null)
      }

      g.append('rect')
        .attr('class', 'hit')
        .attr('fill', 'transparent')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('cursor', 'crosshair')
        .on('mousemove', function (event: MouseEvent) {
          const [mouseX] = pointer(event, this)
          const index = findNearestIndex(mouseX)
          const point = props.points[index]
          const cx = bandCenters[index]
          if (!point || cx === undefined) return

          updateTooltip(
            placeTooltip({
              dataKey,
              host: hostEl,
              clientX: event.clientX,
              clientY: event.clientY,
              label: point.label,
              value: formatCount(point.value)
            })
          )

          if (index === activeIndex) return
          activeIndex = index
          const cy = y(point.value)

          if (!isFocusVisible) {
            isFocusVisible = true
            focusLine.attr('x1', cx).attr('x2', cx)
            focusDot.attr('cx', cx).attr('cy', cy)
            focus.transition().duration(hoverMs(isReduced)).ease(easeCubicOut).attr('opacity', 1)
          } else {
            focusLine
              .transition()
              .duration(hoverMs(isReduced))
              .ease(easeCubicOut)
              .attr('x1', cx)
              .attr('x2', cx)
            focusDot
              .transition()
              .duration(hoverMs(isReduced))
              .ease(easeCubicOut)
              .attr('cx', cx)
              .attr('cy', cy)
          }

          dots
            .transition()
            .duration(hoverMs(isReduced))
            .ease(easeCubicOut)
            .attr('opacity', function (_point, i) {
              return i === index ? 1 : 0.35
            })
            .attr('r', function (_point, i) {
              return i === index ? 4 : 3
            })
        })
        .on('mouseleave', hideFocus)
    },
    [props.points, props.isEmpty, height, width, isReduced, dataKey]
  )

  if (props.isEmpty) {
    return (
      <EmptyHint
        height={height}
        hint={props.emptyHint ?? '暂无数据'}
      />
    )
  }

  return (
    <div
      ref={hostRef}
      className="relative w-full"
      style={{ height }}>
      <svg
        ref={svgRef}
        className={props.className}
        style={{ width: '100%', height }}
        role="img"
        aria-label="折线图"
      />
      <ChartTooltipLayer tooltip={tooltip} dataKey={dataKey} />
    </div>
  )
}

function BarChart(props: BarChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [tooltip, updateTooltip] = useState<ChartTooltipState | null>(null)
  const isReduced = useReducedMotion() === true
  const height = props.height ?? CHART_HEIGHT
  const width = useSvgWidth(svgRef)
  const dataKey = JSON.stringify(props)

  useEffect(
    function () {
      const svgEl = svgRef.current
      const hostEl = hostRef.current
      if (!svgEl || !hostEl || props.isEmpty || props.items.length === 0 || width <= 0) return

      const theme = findChartTheme()
      const innerWidth = Math.max(width - BAR_MARGIN.left - BAR_MARGIN.right, 1)
      const innerHeight = Math.max(height - BAR_MARGIN.top - BAR_MARGIN.bottom, 1)
      const items = [...props.items].reverse()

      clearSvg(svgEl)
      const root = select(svgEl)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%')
        .attr('height', height)

      const g = root
        .append('g')
        .attr('transform', `translate(${BAR_MARGIN.left},${BAR_MARGIN.top})`)

      const y = scaleBand()
        .domain(
          items.map(function (item) {
            return item.name
          })
        )
        .range([0, innerHeight])
        .padding(0.28)

      const xMax = d3Max(items, function (item) {
        return item.value
      })
      const x = scaleLinear()
        .domain([0, Math.max(xMax ?? 0, 1)])
        .nice()
        .range([0, innerWidth])

      g.append('g')
        .call(axisLeft(y).tickSize(0).tickPadding(8))
        .call(function (axis) {
          axis.select('.domain').remove()
          axis
            .selectAll('text')
            .attr('fill', theme.muted)
            .attr('font-size', 10)
            .each(function () {
              const node = this as SVGTextElement
              const text = node.textContent ?? ''
              if (text.length > 14) node.textContent = `${text.slice(0, 13)}…`
            })
        })

      g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(axisBottom(x).ticks(4).tickSize(-innerHeight).tickPadding(6))
        .call(function (axis) {
          axis.select('.domain').attr('stroke', theme.border)
          axis.selectAll('line').attr('stroke', theme.border).attr('stroke-dasharray', '3 3')
          axis.selectAll('text').attr('fill', theme.muted).attr('font-size', 10)
        })

      const bars = g
        .selectAll('rect.bar')
        .data(items)
        .join('rect')
        .attr('class', 'bar')
        .attr('x', 0)
        .attr('y', function (item) {
          return y(item.name) ?? 0
        })
        .attr('height', y.bandwidth())
        .attr('width', function (item) {
          return x(item.value)
        })
        .attr('rx', 3)
        .attr('fill', theme.accent)
        .attr('opacity', 0.9)
        .style('cursor', 'pointer')

      let activeName: string | null = null

      bars
        .on('mousemove', function (event: MouseEvent, item) {
          updateTooltip(
            placeTooltip({
              dataKey,
              host: hostEl,
              clientX: event.clientX,
              clientY: event.clientY,
              label: item.name,
              value: formatCount(item.value)
            })
          )
          if (activeName === item.name) return
          activeName = item.name
          bars
            .transition()
            .duration(hoverMs(isReduced))
            .ease(easeCubicOut)
            .attr('opacity', function (other) {
              return other.name === item.name ? 1 : 0.35
            })
        })
        .on('mouseleave', function () {
          activeName = null
          bars.transition().duration(hoverMs(isReduced)).ease(easeCubicOut).attr('opacity', 0.9)
          updateTooltip(null)
        })
    },
    [props.items, props.isEmpty, height, width, isReduced, dataKey]
  )

  if (props.isEmpty) {
    return (
      <EmptyHint
        height={height}
        hint={props.emptyHint ?? '暂无数据'}
      />
    )
  }

  return (
    <div
      ref={hostRef}
      className="relative w-full"
      style={{ height }}>
      <svg
        ref={svgRef}
        className={props.className}
        style={{ width: '100%', height }}
        role="img"
        aria-label="柱状图"
      />
      <ChartTooltipLayer tooltip={tooltip} dataKey={dataKey} />
    </div>
  )
}

function PieChart(props: PieChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [tooltip, updateTooltip] = useState<ChartTooltipState | null>(null)
  const isReduced = useReducedMotion() === true
  const height = props.height ?? CHART_HEIGHT
  const width = useSvgWidth(svgRef)
  const dataKey = JSON.stringify(props)

  useEffect(
    function () {
      const svgEl = svgRef.current
      const hostEl = hostRef.current
      if (!svgEl || !hostEl || props.isEmpty || props.items.length === 0 || width <= 0) return

      const theme = findChartTheme()
      const palette = [theme.accent, theme.warn, theme.danger, theme.ok, theme.muted]
      const legendH = 36
      const chartH = height - legendH
      const radius = Math.min(width, chartH) / 2 - 8
      const innerRadius = radius * 0.55

      clearSvg(svgEl)
      const root = select(svgEl)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%')
        .attr('height', height)

      const pieGen = d3Pie<NamedCount>()
        .value(function (item) {
          return item.value
        })
        .sort(null)

      const arcs = pieGen(props.items)
      const arcGen = d3Arc<PieArcDatum<NamedCount>>()
        .innerRadius(innerRadius)
        .outerRadius(radius)
        .padAngle(0.02)
        .cornerRadius(3)
      const arcActive = d3Arc<PieArcDatum<NamedCount>>()
        .innerRadius(innerRadius)
        .outerRadius(radius + 4)
        .padAngle(0.02)
        .cornerRadius(3)

      const total = d3Sum(props.items, function (item) {
        return item.value
      })

      const g = root
        .append('g')
        .attr('transform', `translate(${width / 2},${chartH / 2})`)

      const slices = g
        .selectAll('path.slice')
        .data(arcs)
        .join('path')
        .attr('class', 'slice')
        .attr('d', function (datum) {
          return arcGen(datum) ?? ''
        })
        .attr('fill', function (_datum, index) {
          return palette[index % palette.length] ?? theme.accent
        })
        .attr('stroke', theme.surface)
        .attr('stroke-width', 2)
        .attr('opacity', 1)
        .style('cursor', 'pointer')

      let activeIndex = -1

      slices
        .on('mousemove', function (event: MouseEvent, datum) {
          const pct = total > 0 ? Math.round((datum.data.value / total) * 100) : 0
          updateTooltip(
            placeTooltip({
              dataKey,
              host: hostEl,
              clientX: event.clientX,
              clientY: event.clientY,
              label: datum.data.name,
              value: `${formatCount(datum.data.value)} · ${pct}%`
            })
          )
          const index = datum.index
          if (activeIndex === index) return
          activeIndex = index
          slices
            .transition()
            .duration(hoverMs(isReduced))
            .ease(easeCubicOut)
            .attr('d', function (other) {
              return (other === datum ? arcActive(other) : arcGen(other)) ?? ''
            })
            .attr('opacity', function (other) {
              return other === datum ? 1 : 0.45
            })
        })
        .on('mouseleave', function () {
          activeIndex = -1
          slices
            .transition()
            .duration(hoverMs(isReduced))
            .ease(easeCubicOut)
            .attr('d', function (datum) {
              return arcGen(datum) ?? ''
            })
            .attr('opacity', 1)
          updateTooltip(null)
        })

      const legend = root
        .append('g')
        .attr('transform', `translate(${width / 2},${chartH + 8})`)

      const itemWidth = Math.min(88, width / Math.max(props.items.length, 1))
      const legendItems = legend
        .selectAll('g')
        .data(props.items)
        .join('g')
        .attr('transform', function (_item, index) {
          const offset = (index - (props.items.length - 1) / 2) * itemWidth
          return `translate(${offset},0)`
        })

      legendItems
        .append('rect')
        .attr('width', 8)
        .attr('height', 8)
        .attr('rx', 2)
        .attr('y', 2)
        .attr('x', -itemWidth / 2 + 4)
        .attr('fill', function (_item, index) {
          return palette[index % palette.length] ?? theme.accent
        })

      legendItems
        .append('text')
        .attr('x', -itemWidth / 2 + 16)
        .attr('y', 10)
        .attr('fill', theme.muted)
        .attr('font-size', 10)
        .text(function (item) {
          return item.name.length > 6 ? `${item.name.slice(0, 5)}…` : item.name
        })
    },
    [props.items, props.isEmpty, height, width, isReduced, dataKey]
  )

  if (props.isEmpty) {
    return (
      <EmptyHint
        height={height}
        hint={props.emptyHint ?? '暂无数据'}
      />
    )
  }

  return (
    <div
      ref={hostRef}
      className="relative w-full"
      style={{ height }}>
      <svg
        ref={svgRef}
        className={props.className}
        style={{ width: '100%', height }}
        role="img"
        aria-label="饼图"
      />
      <ChartTooltipLayer tooltip={tooltip} dataKey={dataKey} />
    </div>
  )
}

export { BarChart, LineChart, PieChart }
