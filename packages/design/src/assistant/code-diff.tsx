import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'

import { Button } from '../components/button'
import { useAssistantLabels } from './labels'
import { TOOL_ROW_HEIGHT_CLASS } from './tool-row'

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
  /** 文件名旁的次级说明（如工作区相对路径），与文件名同一行，不另起一行 */
  subtitle?: string
  additions: number
  deletions: number
  lines: readonly DiffLine[]
  /** 折进每行 key；递增可重播入场动画 */
  cycle: number
  /** 标题栏右侧操作（紧挨 +/-，与卡片一体） */
  action?: ReactNode
  /**
   * 可折叠：与 `onToggle` 一起传才生效，`false` 时**正文整段不挂载**——
   * 大 diff 不进布局、不跑 stagger 动画，聊天流里只留一行标题。
   * 不传则恒定展开（既有的展开态用法不受影响）。
   */
  expanded?: boolean
  onToggle?: () => void
}

/**
 * 标题栏是**一行 28px**（`TOOL_ROW_HEIGHT_CLASS`），与 `ToolFallback.Trigger`、
 * 命令卡折叠行同一口径：聊天流里连续几张工具卡时，行高必须齐。
 * 文件名 / `+N −M` / 次级说明 / 右侧动作全在这一行里，次级说明不另起一行。
 */
function CodeDiff({
  filename,
  subtitle,
  additions,
  deletions,
  lines,
  cycle,
  action,
  expanded,
  onToggle,
  className,
  ...props
}: CodeDiffProps) {
  const labels = useAssistantLabels()
  const isCollapsible = expanded !== undefined && onToggle !== undefined
  /** 只有真的能折叠时才隐藏正文：漏传 onToggle 时宁可按展开渲染，也不要「藏了又打不开」 */
  const isOpen = !isCollapsible || expanded !== false
  const toggleLabel = isOpen ? labels.diffCollapse : labels.diffExpand

  return (
    <div
      data-slot="code-diff"
      data-state={isCollapsible ? (isOpen ? 'open' : 'closed') : undefined}
      className={cn(PAPER, 'w-full overflow-hidden rounded-xl font-mono text-xs', className)}
      {...props}>
      <div
        data-slot="code-diff-header"
        className={cn('border-border/50 flex items-center gap-2 border-b px-3', TOOL_ROW_HEIGHT_CLASS)}>
        {isCollapsible ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground -ms-1 h-6 w-6 shrink-0 rounded-md p-0"
            aria-expanded={isOpen}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggle}>
            <Icon
              icon="lucide:chevron-right"
              className={cn(
                'size-3.5 shrink-0 transition-transform duration-200',
                isOpen && 'rotate-90'
              )}
            />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className="text-foreground/90 min-w-0 truncate font-medium"
            title={subtitle ? `${filename} · ${subtitle}` : filename}>
            {filename}
          </span>
          <span className={cn(MONO, 'shrink-0 tabular-nums')}>
            <span className="text-success">+{additions}</span>{' '}
            <span className="text-destructive">−{deletions}</span>
          </span>
          {subtitle ? (
            <span
              data-slot="code-diff-subtitle"
              className="text-muted-foreground min-w-0 truncate text-xs"
              title={subtitle}>
              {subtitle}
            </span>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {isOpen ? (
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
      ) : null}
    </div>
  )
}

export { CodeDiff }
export type { CodeDiffProps, DiffKind, DiffLine }
