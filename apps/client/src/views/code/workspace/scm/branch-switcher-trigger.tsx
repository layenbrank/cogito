import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

type BranchSwitcherSize = 'sm' | 'md'

interface BranchSwitcherTriggerProps {
  size: BranchSwitcherSize
  tone: 'toolbar' | 'header'
  branch: string
  isBusy: boolean
  showRemoteDelta: boolean
  ahead: number
  behind: number
  className?: string
}

function BranchSwitcherTrigger(props: BranchSwitcherTriggerProps) {
  const isCompact = props.size === 'sm'

  return (
    <>
      <Icon
        icon={props.isBusy ? 'lucide:loader-circle' : 'lucide:git-branch'}
        className={cn(
          'text-muted-foreground shrink-0',
          isCompact ? 'size-3.5' : 'size-4',
          props.isBusy && 'animate-spin'
        )}
      />
      <span className="min-w-0 flex-1 truncate text-left font-medium">
        {props.branch || '未知分支'}
      </span>
      {props.showRemoteDelta && (props.ahead > 0 || props.behind > 0) ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {props.ahead > 0 ? `↑${props.ahead}` : ''}
          {props.ahead > 0 && props.behind > 0 ? ' ' : ''}
          {props.behind > 0 ? `↓${props.behind}` : ''}
        </span>
      ) : null}
      <Icon
        icon="lucide:chevrons-up-down"
        className="text-muted-foreground size-3.5 shrink-0 opacity-55"
      />
    </>
  )
}

export { BranchSwitcherTrigger }
