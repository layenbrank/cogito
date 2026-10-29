import {
  LineChart,
  PieChart,
  type ChartPoint,
  type NamedCount
} from '@cogito/design/components/charts'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

const CHART_HEIGHT = 200

interface CaptureUsageChartsProps {
  screenshotTrend: ChartPoint[]
  recordingTrend: ChartPoint[]
  screenshotShare: NamedCount[]
  recordingShare: NamedCount[]
  isEmptyScreenshot: boolean
  isEmptyRecording: boolean
}

function ChartSurface(props: {
  title: string
  icon: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border/70 bg-card/60 p-2.5">
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Icon
            icon={props.icon}
            className="size-3.5 text-muted-foreground"
          />
          {props.title}
        </div>
        {props.hint ? (
          <span className="text-[10px] text-muted-foreground">{props.hint}</span>
        ) : null}
      </header>
      {props.children}
    </section>
  )
}

/** 设置页：截屏/录屏占用趋势与已用占比（共享 D3 图） */
function CaptureUsageCharts(props: CaptureUsageChartsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ChartSurface
        title="截屏占用趋势"
        icon="lucide:hard-drive"
        hint="近 14 日 · MB/日">
        <LineChart
          points={props.screenshotTrend}
          height={CHART_HEIGHT}
          isEmpty={props.isEmptyScreenshot}
          emptyHint="暂无截屏占用"
        />
      </ChartSurface>
      <ChartSurface
        title="截屏容量占比"
        icon="lucide:pie-chart"
        hint="已用 / 配额">
        <PieChart
          items={props.screenshotShare}
          height={CHART_HEIGHT}
          isEmpty={props.isEmptyScreenshot}
          emptyHint="暂无截屏占用"
        />
      </ChartSurface>
      <ChartSurface
        title="录屏占用趋势"
        icon="lucide:clapperboard"
        hint="近 14 日 · MB/日">
        <LineChart
          points={props.recordingTrend}
          height={CHART_HEIGHT}
          isEmpty={props.isEmptyRecording}
          emptyHint="暂无录屏占用"
        />
      </ChartSurface>
      <ChartSurface
        title="录屏容量占比"
        icon="lucide:pie-chart"
        hint="已用 / 配额">
        <PieChart
          items={props.recordingShare}
          height={CHART_HEIGHT}
          isEmpty={props.isEmptyRecording}
          emptyHint="暂无录屏占用"
        />
      </ChartSurface>
    </div>
  )
}

export { CaptureUsageCharts }
