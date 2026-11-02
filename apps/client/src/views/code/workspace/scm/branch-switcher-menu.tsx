import { Icon } from '@iconify/react/offline'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@cogito/design/components/dropdown-menu'
import { cn } from 'cn'

interface BranchSwitcherMenuProps {
  branch: string
  /** 本地分支 */
  locals: string[]
  /** `origin/feat` 这类远端分支；点击即 checkout（本地没有同名分支时建跟踪分支） */
  remotes?: string[]
  isCheckoutBusy: boolean
  /** `fromRemote` 非空表示「从远端分支切」 */
  onCheckout: (name: string, fromRemote?: string | null) => void
}

function countLabel(count: number) {
  return (
    <span className="ml-1.5 font-normal tabular-nums normal-case tracking-normal">{count}</span>
  )
}

function BranchItem(props: {
  name: string
  label?: string
  icon: string
  isActive: boolean
  disabled: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <DropdownMenuItem
      title={props.title ?? props.name}
      className={cn(
        'gap-2 rounded-sm px-2 py-2 text-sm',
        props.isActive && 'bg-accent text-accent-foreground'
      )}
      disabled={props.disabled}
      onClick={props.onClick}>
      <Icon
        icon="lucide:check"
        className={cn(
          'size-4 shrink-0',
          props.isActive ? 'text-primary opacity-100' : 'opacity-0'
        )}
      />
      <Icon
        icon={props.icon}
        className="text-muted-foreground size-4 shrink-0 opacity-70"
      />
      <span className="min-w-0 flex-1 truncate font-mono text-sm leading-5">
        {props.label ?? props.name}
      </span>
    </DropdownMenuItem>
  )
}

function BranchSwitcherMenu(props: BranchSwitcherMenuProps) {
  const remotes = props.remotes ?? []

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
          本地分支
          {props.locals.length > 0 ? countLabel(props.locals.length) : null}
        </DropdownMenuLabel>
        {props.locals.map(function (name) {
          const isActive = name === props.branch
          return (
            <BranchItem
              key={`local:${name}`}
              name={name}
              icon="lucide:git-branch"
              isActive={isActive}
              disabled={props.isCheckoutBusy}
              onClick={function () {
                if (isActive) return
                props.onCheckout(name)
              }}
            />
          )
        })}
      </DropdownMenuGroup>

      {remotes.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
              远端分支
              {countLabel(remotes.length)}
            </DropdownMenuLabel>
            {remotes.map(function (name) {
              const isActive = name === props.branch
              return (
                <BranchItem
                  key={`remote:${name}`}
                  name={name}
                  icon="lucide:cloud"
                  isActive={isActive}
                  disabled={props.isCheckoutBusy}
                  title={`切换到 ${name}（本地没有同名分支时建跟踪分支）`}
                  onClick={function () {
                    if (isActive) return
                    props.onCheckout(name, name)
                  }}
                />
              )
            })}
          </DropdownMenuGroup>
        </>
      ) : null}
    </>
  )
}

export { BranchSwitcherMenu }
