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
    'min-w-0 justify-start gap-1.5 font-normal shadow-none',
    isCompact ? 'h-7 px-2 text-xs' : 'h-9 px-2.5 text-sm',
    isHeader
      ? 'text-foreground hover:bg-muted/70 max-w-full flex-1 rounded-sm border-0 bg-transparent'
      : 'border-border/50 bg-muted/30 text-foreground hover:bg-muted/60 max-w-56 rounded-md',
    className
  )
}

export { branchSwitcherButtonClass }
