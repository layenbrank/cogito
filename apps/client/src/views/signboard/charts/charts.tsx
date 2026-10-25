import {
  arc as d3Arc,
  axisBottom,
  axisLeft,
  easeCubicOut,
  max as d3Max,
  pie as d3Pie,
  scaleBand,
  scaleLinear,
  select,
  sum as d3Sum,
  type PieArcDatum
} from 'd3'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { findChartTheme, type NamedCount } from '@/views/signboard/charts/theme'

const CHART_HEIGHT = 160
const BAR_ROW = 28
const BAR_MARGIN = { top: 8, right: 16, bottom: 20, left: 88 }

function findBarHeight(itemCount: number, override?: number) {
  if (override !== undefined) return override
  const n = Math.max(itemCount, 1)
  return Math.max(96, Math.min(200, n * BAR_ROW + 40))
}
const TOOLTIP_OFFSET = 12
const TOOLTIP_EDGE = 8
const MOTION_MS = 180
const TOOLTIP_MOTION_S = MOTION_MS / 1000

interface EmptyableChartProps {
  height?: number
  isEmpty?: boolean
  emptyHint?: string
  className?: string
}

interface BarChartProps extends EmptyableChartProps {
  items: NamedCount[]
}

interface PieChartProps extends EmptyableChartProps {
  items: NamedCount[]
}

interface ChartTooltipState {
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

function hoverMs(isReduced: boolean) {
  return isReduced ? 0 : MOTION_MS
}

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

function BarChart(props: BarChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [tooltip, updateTooltip] = useState<ChartTooltipState | null>(null)
  const isReduced = useReducedMotion() === true
  const height = findBarHeight(props.items.length, props.height)
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
        .attr('fill', function (item) {
          return item.fill ?? theme.accent
        })
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
      <ChartTooltipLayer
        tooltip={tooltip}
        dataKey={dataKey}
      />
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
      const palette = [theme.accent, theme.chart2, theme.danger, theme.ok, theme.muted, theme.chart3]
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

      const g = root.append('g').attr('transform', `translate(${width / 2},${chartH / 2})`)

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

      const legend = root.append('g').attr('transform', `translate(${width / 2},${chartH + 8})`)

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
      <ChartTooltipLayer
        tooltip={tooltip}
        dataKey={dataKey}
      />
    </div>
  )
}

export { BarChart, PieChart, CHART_HEIGHT }
