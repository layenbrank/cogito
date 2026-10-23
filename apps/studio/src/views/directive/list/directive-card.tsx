import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Progress } from '@cogito/design/components/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { memo, type MouseEvent } from 'react'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'

import {
  RUN_STATUS_STYLES,
  type DirectiveRuns,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime
} from '@/views/directive/run/run-status'
import { capsFromSummary } from '@/views/directive/run/run-caps'
import { WallRunBar } from '@/views/directive/run/run-menu'
import { CARD_SIZE } from '@/views/directive/render/card-size'
import { findBucketMark } from './bucket'

/**
 * 指令卡片：一眼看清是哪条指令、几步、几个输入、现在跑得怎么样、上次什么时候跑的、能不能直接跑。
 *
 * 墙面单列流：
 * - 顶行：图标 + 名称 / 描述，右侧贴状态徽标（不再独占宽动作轨）
 * - 底行：元信息 + 删除 / 运行 / cron·watch（有才显）
 *
 * 窄栏仍紧凑，运行用图标钮。
 *
 * 卡片自己是个 `div`（里面还有一键执行按钮），不能用 `button` 套 `button`：整卡的点击交给容器的
 * `onClick`，键盘焦点交给铺满卡片的那层无内容按钮，两者最终都走同一个 `onOpen`。
 *
 * 卡片有几十上百张，父组件的时钟每跳一次就会重渲染一轮，故按值 `memo`。
 * 按下反馈用 CSS 色阶（`active:bg-accent-active`），不用 motion 也不用位移 —— 分组保活后成批挂着，
 * motion 实例更贵，位移/缩放又会抖布局（见 `docs/guides/agent-conventions.md` 的交互约定）。
 */

/** 两种摆放方式下卡片自己的内边距与要不要露出描述 */
const VARIANTS = {
  rail: {
    card: `rounded-xl p-2.5 ${CARD_SIZE.rail.className}`,
    icon: 'size-7 rounded-lg',
    iconGlyph: 'size-4',
    hasSummary: false
  },
  wall: {
    card: `rounded-xl p-3 shadow-xs ${CARD_SIZE.wall.className}`,
    icon: 'size-8 rounded-xl',
    iconGlyph: 'size-4',
    hasSummary: true
  }
}

interface Props {
  entry: DirectiveEntry
  isActive: boolean
  runs: DirectiveRuns
  stepCount: number
  /** 父组件的时钟，按分钟级刷新相对时间 */
  now: number
  variant?: keyof typeof VARIANTS
  onOpen: (name: string) => void
  onRun: (name: string) => void
  onDelete: (name: string) => void
}

function DirectiveCard(props: Props) {
  const { entry, runs } = props
  const variantKey = props.variant ?? 'rail'
  const variant = VARIANTS[variantKey]
  // 解析失败的文件也会被列出来（`summary` 为空）：跑不起来，状态徽标也读不出来，就把这件事顶到最前面
  const isParsed = entry.summary !== null
  const status = isParsed && runs.status ? RUN_STATUS_STYLES[runs.status] : null
  const mark = findBucketMark(entry.bucket)
  const inputCount = entry.summary?.input_count ?? 0
  // 同一条指令能并发跑，徽标只写「运行中」看不出有几路
  const statusLabel =
    status && runs.running > 1 ? `${status.label} ×${runs.running}` : (status?.label ?? '')
  const ranAtTitle = runs.lastAt
    ? `最近执行：${formatAbsoluteTime(runs.lastAt)}${runs.lastDurationMs === null ? '' : `（耗时 ${formatDuration(runs.lastDurationMs)}）`}`
    : ''
  const description = variant.hasSummary ? (entry.summary?.description ?? '') : ''
  const caps = capsFromSummary(entry.summary)

  const statusBadge = !isParsed ? (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 font-normal text-destructive">
      <Icon icon="mdi:file-alert-outline" />
      解析失败
    </Badge>
  ) : status ? (
    <Badge
      variant="outline"
      className={cn('shrink-0 gap-1.5 rounded-full font-normal', status.tone)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          status.dot,
          runs.status === 'running' && 'animate-pulse'
        )}
      />
      {statusLabel}
    </Badge>
  ) : null

  function handleRun(event: MouseEvent) {
    event.stopPropagation()
    props.onRun(entry.name)
  }

  function haltBubble(event: MouseEvent) {
    event.stopPropagation()
  }

  function handleDelete(event: MouseEvent) {
    event.stopPropagation()
    props.onDelete(entry.name)
  }

  const deleteButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={variantKey === 'wall' ? 'outline' : 'ghost'}
            size="icon-sm"
            className={cn(
              'relative z-10 h-8 w-8 shrink-0 cursor-pointer text-muted-foreground',
              variantKey === 'wall' &&
                'border-border/80 opacity-70 group-hover/card:opacity-100 focus-visible:opacity-100',
              variantKey === 'wall'
                ? 'hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive'
                : 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive'
            )}
            aria-label={`删除 ${entry.name}`}
            title={`删除 ${entry.name}`}
            onClick={handleDelete}>
            <Icon
              icon="mdi:trash-can-outline"
              className="size-4"
            />
          </Button>
        }
      />
      <TooltipContent side="top">删除 {entry.name}</TooltipContent>
    </Tooltip>
  )

  const runButton =
    isParsed && variantKey === 'wall' ? (
      <WallRunBar
        name={entry.name}
        caps={caps}
        disabled={!isParsed}
        onOnce={function () {
          props.onRun(entry.name)
        }}
      />
    ) : isParsed ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'relative z-10 shrink-0 cursor-pointer text-muted-foreground',
                'hover:bg-primary hover:text-primary-foreground'
              )}
              aria-label={`运行 ${entry.name}`}
              onClick={handleRun}>
              <Icon
                icon="mdi:play"
                className="size-4"
              />
            </Button>
          }
        />
        <TooltipContent side="top">运行 {entry.name}</TooltipContent>
      </Tooltip>
    ) : null

  const metaTitle = [
    isParsed ? `${props.stepCount} 步 · ${inputCount} 输入` : '',
    runs.failed > 0 ? `${runs.failed} 次失败` : '',
    ranAtTitle
  ]
    .filter(Boolean)
    .join(' · ')

  const meta = (
    <div
      className="w-full min-w-0 truncate text-xs leading-snug text-muted-foreground"
      title={metaTitle || undefined}>
      {isParsed ? (
        <span>
          {props.stepCount} 步 · {inputCount} 输入
        </span>
      ) : null}
      {runs.failed > 0 ? <span className="text-destructive"> · {runs.failed} 次失败</span> : null}
      {runs.lastAt ? (
        <span className="tabular-nums">
          {' · '}
          {formatRelativeTime(runs.lastAt, props.now)}
        </span>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn(
        'group/card relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden border bg-card',
        'transition-[border-color,background-color,box-shadow] duration-200',
        'active:bg-accent-active',
        variant.card,
        // 焦点圈画在容器上：卡片 overflow-hidden，画在里面那层按钮上会被裁掉
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
        props.isActive
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border/70 hover:border-border hover:bg-accent-hover',
        // 阴影只做层次，不跟选中描边叠色；墙面默认轻阴影，悬停略抬起
        variantKey === 'wall'
          ? props.isActive
            ? 'shadow-xs'
            : 'shadow-xs hover:shadow-md'
          : props.isActive
            ? 'shadow-xs'
            : 'shadow-none'
      )}
      onClick={function () {
        props.onOpen(entry.name)
      }}>
      {variantKey === 'wall' ? (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start gap-2.5">
            <span
              title={mark.label}
              className={cn(
                'inline-flex shrink-0 items-center justify-center',
                variant.icon,
                mark.tile
              )}>
              <Icon
                icon={mark.icon}
                className={variant.iconGlyph}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  title={entry.name}
                  className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
                  {entry.name}
                </span>
                {runs.hasUnread ? (
                  <span
                    role="img"
                    aria-label="有还没看过的执行结果"
                    title="有还没看过的执行结果"
                    className="size-1.5 shrink-0 rounded-full bg-primary ring-2 ring-primary/20"
                  />
                ) : null}
                {statusBadge}
              </div>
              {description ? (
                <p
                  title={description}
                  className="truncate text-xs leading-snug text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-auto flex min-w-0 flex-col gap-1.5 pl-10.5">
            {runs.status === 'running' && props.stepCount > 0 ? (
              <div className="flex items-center gap-2">
                <Progress
                  value={Math.min(100, (runs.doneSteps / props.stepCount) * 100)}
                  className="h-1 bg-primary/15"
                  aria-label={`${entry.name} 运行进度`}
                />
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {runs.doneSteps}/{props.stepCount}
                </span>
              </div>
            ) : null}
            <div
              className="flex min-w-0 items-center gap-1.5"
              onClick={haltBubble}
              onPointerDown={haltBubble}>
              <div className="min-w-0 flex-1 overflow-hidden">{meta}</div>
              {deleteButton}
              {runButton}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              title={mark.label}
              className={cn(
                'inline-flex shrink-0 items-center justify-center',
                variant.icon,
                mark.tile
              )}>
              <Icon
                icon={mark.icon}
                className={variant.iconGlyph}
              />
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <span
                title={entry.name}
                className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
                {entry.name}
              </span>
              {runs.hasUnread ? (
                <span
                  role="img"
                  aria-label="有还没看过的执行结果"
                  title="有还没看过的执行结果"
                  className="size-1.5 shrink-0 rounded-full bg-primary ring-2 ring-primary/20"
                />
              ) : null}
              <span className="shrink-0">{statusBadge}</span>
            </div>
          </div>

          {(entry.summary?.description ?? '') ? (
            <p
              title={entry.summary?.description ?? ''}
              className="w-full min-w-0 truncate pl-9 text-xs leading-snug text-muted-foreground">
              {entry.summary?.description}
            </p>
          ) : null}

          <div className="mt-auto flex h-8 min-w-0 items-center gap-1 pl-9 text-xs text-muted-foreground">
            <div className="min-w-0 flex-1 overflow-hidden">{meta}</div>
            {deleteButton}
            {runButton}
          </div>

          {runs.status === 'running' && props.stepCount > 0 ? (
            <div className="flex min-w-0 items-center gap-2 pl-9">
              <Progress
                value={Math.min(100, (runs.doneSteps / props.stepCount) * 100)}
                className="h-1 min-w-0 flex-1 bg-primary/15"
                aria-label={`${entry.name} 运行进度`}
              />
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {runs.doneSteps}/{props.stepCount}
              </span>
            </div>
          ) : null}
        </div>
      )}

      <button
        type="button"
        aria-current={props.isActive}
        aria-label={`打开 ${entry.name}`}
        className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] outline-none"
      />
    </div>
  )
}

export default memo(DirectiveCard, function (prev, next) {
  if (prev.entry !== next.entry) return false
  if (prev.isActive !== next.isActive) return false
  if (prev.stepCount !== next.stepCount) return false
  if (prev.runs !== next.runs) return false
  if (prev.variant !== next.variant) return false
  if (prev.onOpen !== next.onOpen) return false
  if (prev.onRun !== next.onRun) return false
  if (prev.onDelete !== next.onDelete) return false
  // 卡片上随时间变的只有「最近执行」那句相对时间；压根没跑过的卡片不跟着时钟重渲染
  return prev.runs.lastAt === null || prev.now === next.now
})
