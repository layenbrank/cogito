import { cn } from 'cn'

type BranchSwitcherSize = 'sm' | 'md'

function branchSwitcherButtonClass(
  size: BranchSwitcherSize,
  tone: 'toolbar' | 'header',
  className?: string
) {
  const isCompact = size === 'sm'
  const isHeader = tone === 'header'
  return cn(
    // 内容左对齐、宽度随内容；不要默认 flex-1，否则会在底栏/顶栏中间撑出一大块，
    // 看起来像「图标全堆在一侧」而不是左右分区。
    'min-w-0 shrink justify-start gap-1.5 font-normal shadow-none',
    isCompact ? 'h-7 px-2 text-xs' : 'h-9 px-2.5 text-sm',
    isHeader
      ? 'text-foreground hover:bg-muted/70 max-w-full rounded-sm border-0 bg-transparent'
      : 'border-border/50 bg-muted/30 text-foreground hover:bg-muted/60 max-w-56 rounded-md',
    className
  )
}

export { branchSwitcherButtonClass }
