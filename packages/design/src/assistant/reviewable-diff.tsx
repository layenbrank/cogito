/**
 * assistant-ui `reviewable-diff` 元素：把一段 diff 拆成块，逐块决定「保留 / 丢弃」，
 * 头尾的数字全部由块上的决定算出来（不另存计数），「应用」在任何一块待决定前不可点。
 *
 * 元素本体是收费产物，这里按元素页渲染出的 DOM 结构 + 行为自写：`hunks` 由调用方给，
 * 决定状态也由调用方持有（`decision` 字段），本组件只渲染与回调，不碰 diff 数据。
 * 三个回调都可选：传了哪个就渲染哪个控件 —— 只做展示时不传就是纯静态卡片。
 *
 * 与 `code-diff.tsx` 共用 `DiffLine` 形状：同一份行级 diff 既能给 `CodeDiff` 看，
 * 也能切开给这里逐块决定。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { Button } from '../components/button'
import type { DiffKind, DiffLine } from './code-diff'
import { useAssistantLabels } from './labels'

type HunkDecision = 'pending' | 'kept' | 'discarded'

interface DiffHunk {
  /** 块 id：决定状态按它索引，调用方负责稳定 */
  id: string
  /** 块头范围（`@@ -12,6 +12,7 @@` 这类），只用于展示与无障碍文案 */
  range: string
  lines: readonly DiffLine[]
  decision: HunkDecision
}

type ReviewableDiffProps = Omit<ComponentProps<'div'>, 'children'> & {
  filename: string
  hunks: readonly DiffHunk[]
  onKeep?: (id: string) => void
  onDiscard?: (id: string) => void
  /** 已决定的块想改主意；不传就只有静态标签（`onReset` 是 React 的表单事件，别撞名） */
  onUndo?: (id: string) => void
  /** 传了才渲染「应用」按钮；还有块待决定时禁用 */
  onApply?: () => void
}

const GUTTER: Record<DiffKind, string> = {
  context: '',
  added: '+',
  removed: '−'
}

const MONO = 'font-mono text-xs tracking-tight'
/** 块头右侧那颗胶囊：两种决定、两种底色 */
const PILL = 'h-6 rounded-full px-2 text-xs font-medium'
const KEPT_PILL = 'bg-success/12 text-success hover:bg-success/20'
const DISCARDED_PILL =
  'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/90'

function countDecisions(hunks: readonly DiffHunk[]) {
  let kept = 0
  let pending = 0
  for (const hunk of hunks) {
    if (hunk.decision === 'kept') kept += 1
    else if (hunk.decision === 'pending') pending += 1
  }
  return { kept, pending }
}

function HunkLines(props: { lines: readonly DiffLine[]; isDiscarded: boolean }) {
  return (
    <div
      className={cn(
        'overflow-x-auto pb-1.5 font-mono text-xs transition-opacity duration-300',
        props.isDiscarded && 'opacity-45'
      )}>
      <div className="w-max min-w-full">
        {props.lines.map(function (line, index) {
          return (
            <div
              key={index}
              className={cn(
                'flex px-3.5 py-0.5 leading-relaxed whitespace-pre',
                line.kind === 'context' && 'text-muted-foreground',
                line.kind === 'added' && 'bg-success/10 text-success dark:bg-success/10',
                line.kind === 'removed' &&
                  'bg-destructive/10 text-destructive dark:bg-destructive/10'
              )}>
              <span className="w-4 shrink-0 select-none">{GUTTER[line.kind]}</span>
              <span>{line.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HunkDecisionBadge(props: {
  hunk: DiffHunk
  onUndo?: (id: string) => void
  label: string
  undoLabel: string
}) {
  const isKept = props.hunk.decision === 'kept'
  const className = cn(PILL, isKept ? KEPT_PILL : DISCARDED_PILL, !props.onUndo && 'cursor-default')
  const content = (
    <>
      <Icon
        icon={isKept ? 'lucide:check' : 'lucide:x'}
        className="size-3"
      />
      {props.label}
    </>
  )

  if (!props.onUndo) {
    return (
      <span
        className={cn(className, 'inline-flex items-center gap-1')}
        aria-label={props.label}>
        {content}
      </span>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn(className, 'gap-1')}
      aria-label={props.undoLabel}
      title={props.undoLabel}
      onClick={function () {
        props.onUndo?.(props.hunk.id)
      }}>
      {content}
    </Button>
  )
}

function ReviewableDiff(props: ReviewableDiffProps) {
  const {
    filename,
    hunks,
    onKeep,
    onDiscard,
    onUndo,
    onApply,
    className,
    ...rest
  } = props
  const labels = useAssistantLabels()
  const { kept, pending } = countDecisions(hunks)

  return (
    <div
      data-slot="reviewable-diff"
      className={cn(
        'bg-card border-border/60 flex w-full flex-col overflow-hidden rounded-xl border',
        className
      )}
      {...rest}>
      <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-2">
        <span className={cn(MONO, 'text-foreground/90 truncate')}>{filename}</span>
        <span className={cn(MONO, 'text-muted-foreground shrink-0 tabular-nums')}>
          {labels.reviewKeptOfTotal(kept, hunks.length)}
        </span>
      </div>

      <div className="flex flex-col">
        {hunks.map(function (hunk) {
          return (
            <div
              key={hunk.id}
              data-decision={hunk.decision}
              className="border-foreground/[0.06] border-t">
              <div className="flex items-center gap-2 px-3.5 py-1.5">
                <span className={cn(MONO, 'text-muted-foreground truncate tabular-nums')}>
                  {hunk.range}
                </span>
                <span className="ms-auto flex shrink-0 items-center gap-1">
                  {hunk.decision === 'pending' ? (
                    <>
                      {onDiscard ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className={cn(PILL, DISCARDED_PILL, 'gap-1')}
                          aria-label={labels.reviewDiscardHunk(hunk.range)}
                          onClick={function () {
                            onDiscard(hunk.id)
                          }}>
                          <Icon
                            icon="lucide:x"
                            className="size-3"
                          />
                          {labels.reviewDiscard}
                        </Button>
                      ) : null}
                      {onKeep ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className={cn(PILL, KEPT_PILL, 'gap-1')}
                          aria-label={labels.reviewKeepHunk(hunk.range)}
                          onClick={function () {
                            onKeep(hunk.id)
                          }}>
                          <Icon
                            icon="lucide:check"
                            className="size-3"
                          />
                          {labels.reviewKeep}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <HunkDecisionBadge
                      hunk={hunk}
                      onUndo={onUndo}
                      label={hunk.decision === 'kept' ? labels.reviewKept : labels.reviewDiscarded}
                      undoLabel={labels.reviewUndoHunk(hunk.range)}
                    />
                  )}
                </span>
              </div>
              <HunkLines
                lines={hunk.lines}
                isDiscarded={hunk.decision === 'discarded'}
              />
            </div>
          )
        })}
      </div>

      <div className="border-foreground/[0.06] flex items-center justify-between gap-2 border-t px-3.5 py-2">
        <span className={cn(MONO, 'text-muted-foreground tabular-nums')}>
          {pending > 0 ? labels.reviewLeftToReview(pending) : labels.reviewAllReviewed}
        </span>
        {onApply ? (
          <Button
            type="button"
            size="xs"
            className="bg-foreground text-background hover:bg-foreground/90 h-7 shrink-0 rounded-full px-3 font-medium"
            disabled={pending > 0}
            onClick={onApply}>
            {labels.reviewApply(kept)}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export { ReviewableDiff }
export type { DiffHunk, HunkDecision, ReviewableDiffProps }
