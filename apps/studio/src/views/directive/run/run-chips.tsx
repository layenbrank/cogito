import { Button } from '@cogito/design/components/button'
import { Progress } from '@cogito/design/components/progress'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { CorexRun } from '@/stores/corex'

import { RUN_STATUS_STYLES, formatElapsed, isRunning } from './run-status'

/**
 * 运行任务条：一条指令一枚标签（单次与守护触发复用同一枚），最新起的排最前
 * （横滑时新任务不会被挤到看不见的地方）。
 *
 * 任务多到装不下时得让人**知道**两边还有内容，故两端各挂一层渐隐：只在确实被裁掉时出现，
 * 静止不动时不该看上去像被切了一刀。渐隐必须挂在滚动容器**外面** —— 挂里面会跟着内容
 * 一起滚，等于没有。
 *
 * 选中某条任务后把它滚进可视区，用 `offsetLeft` 自己算：`scrollIntoView` 会连带滚动祖先
 * 容器（编辑器、指令列表），点一下整个页面就跑偏了。
 *
 * 不用 motion / layout：台面开合会整树挂卸载，layout 动画会在分栏回流时二次测量整条任务条。
 */

/** 滚进可视区时两端各留的空隙 */
const EDGE_PAD = 12
/** 亚像素与缩放会带来 1px 级的误差，判定「有没有被裁掉」时留出余量 */
const EDGE_HIT = 1

interface Fades {
  start: boolean
  end: boolean
}

const NO_FADES: Fades = { start: false, end: false }

interface Props {
  runs: readonly CorexRun[]
  selectedId: string | null
  /** 指令名 → 声明的步骤数，用来算进度与「x/y 步」 */
  stepCounts: Record<string, number>
  /** 任务条的时钟，跑秒级耗时 */
  now: number
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

interface ChipProps {
  run: CorexRun
  isSelected: boolean
  stepTotal: number
  now: number
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

function RunChip(props: ChipProps) {
  const { run } = props
  const style = RUN_STATUS_STYLES[run.status]
  const running = isRunning(run)

  return (
    <div
      data-run-id={run.id}
      className={cn(
        'group/chip relative flex shrink-0 items-center gap-1 overflow-hidden rounded-md border border-border py-1 pr-1 pl-2 text-xs',
        props.isSelected
          ? 'border-primary bg-accent text-accent-foreground ring-1 ring-primary/20'
          : 'hover:bg-accent-hover'
      )}>
      <button
        type="button"
        className="flex items-center gap-1.5"
        title={`${run.name} · ${formatElapsed(run, props.now)}`}
        onClick={function () {
          props.onSelect(run.id)
        }}>
        <Icon
          icon={style.icon}
          className={cn('size-3.5', style.tone, running && 'animate-pulse')}
        />
        <span className="max-w-40 truncate font-medium">{run.name}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatElapsed(run, props.now)}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100"
        aria-label={`移除 ${run.name} 的运行记录`}
        disabled={running}
        onClick={function () {
          props.onRemove(run.id)
        }}>
        <Icon icon="mdi:close" />
      </Button>

      {running && props.stepTotal > 0 ? (
        <Progress
          value={Math.min(100, (run.doneSteps / props.stepTotal) * 100)}
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-none"
          aria-label={`${run.name} 运行进度`}
        />
      ) : null}
    </div>
  )
}

function RunChips(props: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [fades, setFades] = useState<Fades>(NO_FADES)

  const ordered = useMemo(
    function () {
      return [...props.runs].reverse()
    },
    [props.runs]
  )

  useEffect(function () {
    const strip = stripRef.current
    const content = contentRef.current
    if (!strip || !content) return

    const sync = function () {
      const start = strip.scrollLeft > EDGE_HIT
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - EDGE_HIT
      setFades(function (prev) {
        return prev.start === start && prev.end === end ? prev : { start, end }
      })
    }

    strip.addEventListener('scroll', sync, { passive: true })
    // 任务增减、面板拉伸都改变可滑范围，但都不触发 scroll，得靠 observer 兜住
    const observer = new ResizeObserver(sync)
    observer.observe(strip)
    observer.observe(content)

    return function () {
      strip.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [])

  // 已经看得见就别动，免得每次点选都闪一下
  useEffect(
    function () {
      const strip = stripRef.current
      if (!strip || !props.selectedId) return

      const chip = strip.querySelector<HTMLElement>(`[data-run-id="${props.selectedId}"]`)
      if (!chip) return

      const left = chip.offsetLeft - EDGE_PAD
      const right = chip.offsetLeft + chip.offsetWidth + EDGE_PAD
      if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left)
      else if (right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = right - strip.clientWidth
      }
    },
    [props.selectedId, props.runs.length]
  )

  return (
    <div className="relative shrink-0 border-b">
      <div
        ref={stripRef}
        className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        <div
          ref={contentRef}
          className="flex w-max items-center gap-1.5">
          {ordered.map(function (run) {
            return (
              <RunChip
                key={run.id}
                run={run}
                isSelected={run.id === props.selectedId}
                stepTotal={props.stepCounts[run.name] ?? 0}
                now={props.now}
                onSelect={props.onSelect}
                onRemove={props.onRemove}
              />
            )
          })}
        </div>
      </div>

      {fades.start ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-linear-to-r from-card to-transparent" />
      ) : null}
      {fades.end ? (
        <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-card to-transparent" />
      ) : null}
    </div>
  )
}

export default RunChips
