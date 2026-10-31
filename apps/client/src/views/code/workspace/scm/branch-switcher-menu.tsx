import { Icon } from '@iconify/react/offline'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel
} from '@cogito/design/components/dropdown-menu'
import { cn } from 'cn'

interface BranchSwitcherMenuProps {
  branch: string
  list: string[]
  isCheckoutBusy: boolean
  onCheckout: (name: string) => void
}

function BranchSwitcherMenu(props: BranchSwitcherMenuProps) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
        本地分支
        {props.list.length > 0 ? (
          <span className="ml-1.5 font-normal tabular-nums normal-case tracking-normal">
            {props.list.length}
          </span>
        ) : null}
      </DropdownMenuLabel>
      {props.list.map(function (name) {
        const isActive = name === props.branch
        return (
          <DropdownMenuItem
            key={name}
            title={name}
            className={cn(
              'gap-2 rounded-sm px-2 py-2 text-sm',
              isActive && 'bg-accent text-accent-foreground'
            )}
            disabled={props.isCheckoutBusy}
            onClick={function () {
              if (isActive) return
              props.onCheckout(name)
            }}>
            <Icon
              icon="lucide:check"
              className={cn(
                'size-4 shrink-0',
                isActive ? 'text-primary opacity-100' : 'opacity-0'
              )}
            />
            <Icon
              icon="lucide:git-branch"
              className="text-muted-foreground size-4 shrink-0 opacity-70"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-sm leading-5">
              {name}
            </span>
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuGroup>
  )
}

export { BranchSwitcherMenu }
