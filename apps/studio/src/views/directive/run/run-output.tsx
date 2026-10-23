import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Glide } from '@/components/glide/glide'
import type { CorexRun } from '@/stores/corex'
import { useRunFrames } from '@/stores/run-logs'
import { copyText } from '@/utils/clipboard'

import { useNow } from '@/views/directive/use-now'
import { formatLogText, formatRunLogs } from './run-log'
import { LOG_LEVEL_STYLES, RUN_STATUS_STYLES, formatElapsed, isRunning } from './run-status'
import type { RunLog } from './types'

/**
 * 运行台选中任务的输出。
 *
 * 这是**唯一**订阅进度帧的地方：帧每秒能来几百条，订阅它的组件就得跟着重渲染；运行台
 * 的标题栏与任务条只看运行元数据，不碰帧。帧先攒批落地（见 `@/stores/run-logs`），
 * 日志行再按 `memo` 比较，于是一批帧只让「尾巴那一行」重渲染，其余行原地不动 ——
 * 这就是不再闪烁、滚动也不再被反复打断的原因。
 *
 * 「跟着新输出走 / 停手」是**一个状态**（`follow`）而不是散着的若干 ref：`isFollowing`
 * 决定要不要贴底，`anchor` 记住停手那一刻已有多少行，用来算停手后又来了多少行。
 */

const FILTERS = ['ALL', 'INFO', 'SUCCESS', 'ERROR'] as const

type Filter = (typeof FILTERS)[number]

const FILTER_LABELS: Record<Filter, string> = {
  ALL: '全部',
  INFO: '信息',
  SUCCESS: '成功',
  ERROR: '错误'
}

const FILTER_LEVELS: Record<Filter, RunLog['level'] | null> = {
  ALL: null,
  INFO: 'info',
  SUCCESS: 'success',
  ERROR: 'error'
}

const LEVEL_FILTERS: Record<RunLog['level'], Filter> = {
  info: 'INFO',
  success: 'SUCCESS',
  error: 'ERROR'
}

const FILTER_ICONS: Record<Filter, string> = {
  ALL: 'mdi:view-list-outline',
  INFO: 'mdi:information-outline',
  SUCCESS: 'mdi:check-circle-outline',
  ERROR: 'mdi:alert-circle-outline'
}

/** 「算不算贴底」的容差：滚动事件的亚像素误差不该把手动滚动误判成跟随 */
const BOTTOM_GAP = 24

/** 耗时刷新：只在本条任务还在跑时开表 */
const ELAPSED_MS = 500

/** 贴底时不走平滑滚动、也不让浏览器自己锚定 —— 两者都会跟逐帧追加的输出打架 */
const FULL_SCROLL = { scrollBehavior: 'auto', overflowAnchor: 'none' } as const

interface Follow {
  isFollowing: boolean
  /** 停手那一刻已有多少行 */
  anchor: number
}

const FOLLOWING: Follow = { isFollowing: true, anchor: 0 }

interface Props {
  run: CorexRun
  /** 指令声明的步骤数，用来算「执行 n/m 步」 */
  stepTotal: number
}

/** 空输出的原因得说清楚：被关键字筛掉 / 被级别筛掉 / 还在跑 / 跑完了但确实没有输出 */
function formatEmptyHint(filter: Filter, run: CorexRun, query: string): string {
  if (query) return `没有包含「${query}」的记录`
  if (filter !== 'ALL') return `没有「${FILTER_LABELS[filter]}」级别的记录`
  return isRunning(run)
    ? '等待输出…'
    : '这条任务没有输出：步骤可能被 when 跳过，或动作本身不输出内容'
}

const LogRow = memo(
  function (props: { entry: RunLog }) {
    const style = LOG_LEVEL_STYLES[props.entry.level]
    const isBlock = props.entry.message.includes('\n')

    return (
      <div
        className={cn(
          'hover:bg-accent/40 -mx-1.5 flex items-start gap-2 rounded px-1.5 py-0.5',
          props.entry.level === 'error' && 'bg-destructive/5'
        )}>
        <span className="shrink-0 text-muted-foreground tabular-nums">{props.entry.time}</span>
        <Icon
          icon={style.icon}
          className={cn('mt-0.5 size-3.5 shrink-0', style.tone)}
        />
        <span
          className={cn(
            'min-w-0 flex-1 break-all whitespace-pre-wrap',
            style.tone,
            isBlock && cn('-ml-2 border-l-2 pl-2', style.rail)
          )}>
          {props.entry.message}
        </span>
      </div>
    )
  },
  function (prev, next) {
    const a = prev.entry
    const b = next.entry
    return a.id === b.id && a.time === b.time && a.level === b.level && a.message === b.message
  }
)

function RunOutput(props: Props) {
  const { run } = props
  const [filter, updateFilter] = useState<Filter>('ALL')
  const [follow, updateFollow] = useState<Follow>(FOLLOWING)
  const [query, updateQuery] = useState('')
  const [isFinding, setFinding] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const shownRef = useRef<readonly RunLog[]>([])

  const now = useNow(ELAPSED_MS, isRunning(run))
  const { frames, dropped } = useRunFrames(run.id)

  const logs = useMemo(
    function () {
      return formatRunLogs(run, frames, props.stepTotal)
    },
    [run, frames, props.stepTotal]
  )

  const counts = useMemo(
    function () {
      const tally: Record<Filter, number> = { ALL: logs.length, INFO: 0, SUCCESS: 0, ERROR: 0 }
      logs.forEach(function (entry) {
        tally[LEVEL_FILTERS[entry.level]] += 1
      })
      return tally
    },
    [logs]
  )

  const level = FILTER_LEVELS[filter]
  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    function () {
      const byLevel = level
        ? logs.filter(function (entry) {
            return entry.level === level
          })
        : logs
      if (!needle) return byLevel
      return byLevel.filter(function (entry) {
        return entry.message.toLowerCase().includes(needle)
      })
    },
    [logs, level, needle]
  )

  // 行数得让滚动回调读得到，而 ref 不能在渲染期写，故走 effect（排在下面的贴底 effect 之前）
  useEffect(
    function () {
      shownRef.current = shown
    },
    [shown]
  )

  /** 贴底就跟着新输出走；手一往上滚就停手，别把人从上面拽回来 */
  useEffect(
    function () {
      const scroller = scrollerRef.current
      if (!scroller || !follow.isFollowing) return
      scroller.scrollTop = scroller.scrollHeight
    },
    [shown, dropped, follow.isFollowing]
  )

  const handleScroll = useCallback(function (event: React.UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget
    const isAtBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_GAP
    updateFollow(function (prev) {
      if (prev.isFollowing === isAtBottom) return prev
      return { isFollowing: isAtBottom, anchor: shownRef.current.length }
    })
  }, [])

  const handleFollow = useCallback(function () {
    updateFollow(FOLLOWING)
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [])

  /** 关掉查找时顺手清掉关键字：一个看不见的筛选条件只会让人以为日志丢了 */
  const closeFind = useCallback(function () {
    setFinding(false)
    updateQuery('')
  }, [])

  const handleFind = useCallback(function () {
    setFinding(function (prev) {
      return !prev
    })
  }, [])

  /** 复制的是**筛选后**的内容，跟眼前这片日志一致 */
  const handleCopy = useCallback(
    function () {
      void copyText(formatLogText(shown)).then(
        function () {
          toast.success('日志已复制', { duration: 1200 })
        },
        function (error) {
          console.error('[directive] 复制日志失败', error)
          toast.error('复制失败，可以手动选中复制')
        }
      )
    },
    [shown]
  )

  const newCount = follow.isFollowing ? 0 : Math.max(0, shown.length - follow.anchor)
  const status = RUN_STATUS_STYLES[run.status]

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={4}
          value={[filter]}
          onValueChange={function (value) {
            const next = value[0]
            if (next) updateFilter(next as Filter)
          }}>
          {FILTERS.map(function (item) {
            return (
              <ToggleGroupItem
                key={item}
                value={item}
                className="h-7 gap-1 rounded-full px-2.5 text-xs">
                <Icon icon={FILTER_ICONS[item]} />
                {FILTER_LABELS[item]}
                <span className="tabular-nums opacity-60">{counts[item]}</span>
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>

        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              'text-muted-foreground hover:text-foreground',
              isFinding && 'text-foreground'
            )}
            aria-label="查找日志"
            aria-pressed={isFinding}
            title="查找日志"
            onClick={handleFind}>
            <Icon icon="mdi:magnify" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="复制日志"
            title="复制日志"
            disabled={shown.length === 0}
            onClick={handleCopy}>
            <Icon icon="mdi:content-copy" />
          </Button>
          <Icon
            icon={status.icon}
            className={cn('size-3.5', status.tone, isRunning(run) && 'animate-pulse')}
          />
          <span className={status.tone}>{status.label}</span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {formatElapsed(run, now)}
          </span>
          {props.stepTotal > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              {run.doneSteps}/{props.stepTotal} 步
            </span>
          ) : null}
        </span>
      </div>

      {/* 查找栏是临时的：展开时多一行，关掉不留痕迹，不去挤上面那排筛选 */}
      {isFinding ? (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <div className="relative min-w-0 flex-1">
            <Icon
              icon="mdi:magnify"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              value={query}
              placeholder="在日志里查找…"
              className="h-7 pr-7 pl-8 text-xs"
              onChange={function (event) {
                updateQuery(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key === 'Escape') closeFind()
              }}
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-0.5 -translate-y-1/2"
                aria-label="清空查找"
                title="清空查找"
                onClick={function () {
                  updateQuery('')
                }}>
                <Icon icon="mdi:close" />
              </Button>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {needle ? `${shown.length}/${logs.length} 条` : `${logs.length} 条`}
          </span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <Glide.Y
          className="absolute inset-0"
          wrapperRef={scrollerRef}
          onScroll={handleScroll}
          styles={{ wrapper: FULL_SCROLL }}>
          <div className="px-3 pb-3 font-mono text-xs leading-relaxed">
            {dropped > 0 ? (
              <p className="py-1 text-muted-foreground">{`更早的 ${dropped} 帧输出已省略`}</p>
            ) : null}
            {shown.length === 0 ? (
              <p className="py-8 text-center font-sans text-muted-foreground">
                {formatEmptyHint(filter, run, query.trim())}
              </p>
            ) : (
              shown.map(function (entry) {
                return (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                  />
                )
              })
            )}
          </div>
        </Glide.Y>

        {follow.isFollowing || shown.length === 0 ? null : (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="absolute right-3 bottom-3 shadow-md"
            onClick={handleFollow}>
            <Icon icon="mdi:arrow-down" />
            回到最新
            {newCount > 0 ? (
              <span className="tabular-nums opacity-70">{`+${newCount}`}</span>
            ) : null}
          </Button>
        )}
      </div>
    </section>
  )
}

export default memo(RunOutput)
