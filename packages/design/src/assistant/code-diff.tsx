import type { ComponentProps, ReactNode } from 'react'
import { cn } from 'cn'

type DiffKind = 'context' | 'added' | 'removed'

interface DiffLine {
  kind: DiffKind
  text: string
}

const GUTTER: Record<DiffKind, string> = {
  context: '',
  added: '+',
  removed: '−'
}

const PAPER = 'bg-card border-border/60 border'
/** 尺寸跟随外层 `text-xs`：设计包的字号只能取刻度，11px 这种任意值会让 diff 比正文还虚 */
const MONO = 'font-mono tracking-tight'
const CODE_SCROLL = 'overflow-x-auto overscroll-x-contain'
const CODE_SURFACE = 'w-max min-w-full'
/** 行入场 stagger 上限，避免大 diff 拖到数秒 */
const STAGGER_CAP = 24
const STAGGER_MS = 40

interface CodeDiffProps extends Omit<
  ComponentProps<'div'>,
  'children' | 'filename' | 'additions' | 'deletions' | 'lines' | 'cycle'
> {
  filename: string
  /** 文件名旁的次级说明（如工作区相对路径） */
  subtitle?: string
  additions: number
  deletions: number
  lines: readonly DiffLine[]
  /** 折进每行 key；递增可重播入场动画 */
  cycle: number
  /** 标题栏右侧操作（紧挨 +/-，与卡片一体） */
  action?: ReactNode
}

function CodeDiff({
  filename,
  subtitle,
  additions,
  deletions,
  lines,
  cycle,
  action,
  className,
  ...props
}: CodeDiffProps) {
  return (
    <div
      data-slot="code-diff"
      className={cn(PAPER, 'w-full overflow-hidden rounded-xl font-mono text-xs', className)}
      {...props}>
      <div className="border-border/50 flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              className="text-foreground/90 min-w-0 truncate font-medium"
              title={subtitle ? `${filename} · ${subtitle}` : filename}>
              {filename}
            </span>
            <span className={cn(MONO, 'shrink-0 tabular-nums')}>
              <span className="text-success">+{additions}</span>{' '}
              <span className="text-destructive">−{deletions}</span>
            </span>
          </div>
          {subtitle ? (
            <p
              className="text-muted-foreground mt-0.5 truncate text-xs leading-none"
              title={subtitle}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn(CODE_SCROLL, 'max-h-[min(42vh,24rem)]')}>
        <div className={CODE_SURFACE}>
          {lines.map(function (line, index) {
            const delay = index < STAGGER_CAP ? `${index * STAGGER_MS}ms` : undefined
            return (
              <div
                key={`${cycle}-${index}-${line.kind}-${line.text}`}
                className={cn(
                  'flex px-3 py-0.5 leading-relaxed whitespace-pre',
                  delay && 'fade-in animate-in fill-mode-both duration-300',
                  line.kind === 'context' && 'text-muted-foreground',
                  line.kind === 'added' && 'bg-success/10 text-success dark:bg-success/10',
                  line.kind === 'removed' &&
                    'bg-destructive/10 text-destructive dark:bg-destructive/10'
                )}
                style={delay ? { animationDelay: delay } : undefined}>
                <span className="w-4 shrink-0 select-none">{GUTTER[line.kind]}</span>
                <span>{line.text}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { CodeDiff }
export type { CodeDiffProps, DiffKind, DiffLine }
