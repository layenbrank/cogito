/**
 * Job progress（对齐 assistant-ui `elements/job-progress`）
 *
 * 「一件要跑几分钟的事」的一张卡：抬头是状态图标 + 标题 + ETA/状态词/耗时
 * （运行中还能取消），中间一条加权进度条，下面每个阶段一个等宽标签、当前阶段
 * 的那行说明，收据态再补一段 summary —— 跑完之后这张卡不消失，只是变成一个回执。
 *
 * 与 `agent-plan.tsx` 的区别：
 * - agent-plan 讲「清单走到第几步」，进度按**步数**等分；
 * - 本元素讲「一件任务的阶段推进」，每个阶段有 `weight`，进度按**权重**加权，
 *   而且结算时的 `outcome` 会压过数字进度（收据优先于条）。
 *
 * 元素本体是收费产物，结构 / 行为 / 无障碍属性按官网渲染出的 DOM 与 `.md` 自写；
 * 字号走本仓档位（标题 `text-sm`、等宽槽 `mono` 即 `text-xs`），不照搬 13.5px / 11px；
 * 颜色走 token（`text-success` / `text-warning` / `text-destructive`），不写死 amber-500。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { ghostButton, mono } from './elements/surfaces'
import {
  findJobProgress,
  findJobTone,
  formatElapsed,
  type JobOutcome,
  type JobStage
} from './job-progress-state'
import { useAssistantLabels } from './labels'

interface JobProgressProps {
  /** 任务标题；同时用作进度条的无障碍名称 */
  title: string
  /** 加权阶段：`weight` 是它在整条条里的相对份额，`description` 只在它是当前阶段时显示 */
  stages: readonly JobStage[]
  /** 当前（或最终）阶段下标；钳进 `0…stages.length`，等于长度且没有 outcome 就是成功跑完 */
  stageIndex: number
  /** 当前阶段内的份额（`0…1`），只贡献当前阶段那一段的加权份额 */
  stageProgress: number
  /** 运行中的等宽槽文案（`starting` / `about 3 min`）；空则退回「运行中」 */
  eta: string
  /** 只在运行中显示的取消；收据态一律不显示取消按钮 */
  onCancel?: () => void
  /** 最终回执：压过数字进度，决定图标 / 状态词 / 条的颜色 */
  outcome?: JobOutcome
  /** 终态耗时（毫秒），渲染成 `<time datetime="PT72S">1m 12s</time>` */
  elapsedMs?: number
  className?: string
}

function JobProgress({
  title,
  stages,
  stageIndex,
  stageProgress,
  eta,
  onCancel,
  outcome,
  elapsedMs,
  className
}: JobProgressProps) {
  const labels = useAssistantLabels()
  const progress = findJobProgress(stages, stageIndex, stageProgress, outcome)
  const tone = findJobTone(progress.state, labels)
  const elapsed = formatElapsed(elapsedMs)

  // 抬头的等宽槽：运行中是 ETA；收据态有耗时就是 <time>，没有就退回状态词
  const terminal =
    progress.settled && elapsed ? (
      <time dateTime={elapsed.iso}>{elapsed.text}</time>
    ) : progress.settled ? (
      tone.word
    ) : (
      eta || tone.word
    )

  const current = progress.current

  return (
    <div
      data-slot="job-progress"
      data-state={progress.state}
      className={cn(
        'bg-background border-border/60 dark:bg-popover flex w-full max-w-sm flex-col gap-3 rounded-2xl border p-4',
        className
      )}>
      <div
        data-slot="job-progress-header"
        className="flex items-center gap-2.5">
        <Icon
          icon={tone.icon}
          aria-hidden
          className={cn('size-3.5 shrink-0', tone.iconClassName)}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className={cn(mono, 'shrink-0 tabular-nums')}>{terminal}</span>
        {progress.settled || !onCancel ? null : (
          <button
            type="button"
            aria-label={labels.jobCancel}
            title={labels.jobCancel}
            onClick={onCancel}
            className={cn(ghostButton, 'size-6 shrink-0')}>
            <Icon
              icon="lucide:x"
              aria-hidden
              className="size-3.5"
            />
          </button>
        )}
      </div>

      <span
        data-slot="job-progress-bar"
        role="progressbar"
        aria-label={labels.jobProgress(title)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className="bg-foreground/[0.06] inset-ring-border inset-ring h-1 w-full overflow-hidden rounded-full forced-colors:border">
        <span
          aria-hidden
          className={cn(
            'block h-full rounded-full',
            'forced-color-adjust-none transition-[width] ease-out motion-reduce:transition-none',
            // 进度条 500ms 是元素口径（比聊天里其它动效 220ms 慢），宽度变化才不显得抖
            'duration-500',
            tone.barClassName
          )}
          style={{ width: `${progress.percent}%` }}
        />
      </span>

      <div
        data-slot="job-progress-stages"
        className="flex flex-col gap-0.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {progress.stages.map(function (stage) {
            return (
              <span
                key={stage.id}
                data-slot="job-progress-stage"
                data-status={stage.status}
                className={mono}>
                {stage.name}
              </span>
            )
          })}
        </div>
        {current?.description ? (
          <p className="text-muted-foreground mt-0.5 text-sm leading-snug break-words">
            {current.description}
          </p>
        ) : null}
      </div>

      {outcome?.summary ? (
        <p
          data-slot="job-progress-summary"
          className="text-muted-foreground text-sm leading-snug break-words">
          {outcome.summary}
        </p>
      ) : null}

      {/* 读屏：运行中播报当前阶段，收据态播报最终结论 */}
      <span
        role="status"
        className="sr-only">
        {progress.settled
          ? labels.jobOutcomeAnnounce(tone.word)
          : labels.jobStageAnnounce(current?.name ?? title)}
      </span>
    </div>
  )
}

export { JobProgress }
export type { JobProgressProps }
