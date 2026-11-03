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
  /** footer / 窄栏：少一个 chevron，避免与 git-branch 挤成一坨图标 */
  const showChevrons = props.tone !== 'header' || !isCompact

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
      <span
        className={cn(
          'min-w-0 truncate text-left font-medium',
          // 仅在按钮被调用方拉宽时让分支名吃剩余空间，默认随内容
          props.tone === 'header' && !isCompact && 'flex-1'
        )}>
        {props.branch || '未知分支'}
      </span>
      {props.showRemoteDelta && (props.ahead > 0 || props.behind > 0) ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {props.ahead > 0 ? `↑${props.ahead}` : ''}
          {props.ahead > 0 && props.behind > 0 ? ' ' : ''}
          {props.behind > 0 ? `↓${props.behind}` : ''}
        </span>
      ) : null}
      {showChevrons ? (
        <Icon
          icon="lucide:chevrons-up-down"
          className="text-muted-foreground size-3.5 shrink-0 opacity-55"
        />
      ) : null}
    </>
  )
}

export { BranchSwitcherTrigger }
