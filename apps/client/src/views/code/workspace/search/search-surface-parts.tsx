import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import type { ReactNode } from 'react'

function ToggleButton(props: {
  icon: string
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={props.label}
      aria-pressed={props.isActive}
      title={props.label}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm border border-transparent',
        props.isActive
          ? 'bg-primary/15 text-primary border-primary/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-3.5"
      />
    </Button>
  )
}

function HeaderAction(props: {
  icon: string
  label: string
  isDisabled?: boolean
  isSpinning?: boolean
  onClick(): void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.isDisabled}
      className={cn(
        'hover:bg-muted hover:text-foreground text-muted-foreground flex size-5 items-center justify-center rounded-sm',
        props.isDisabled && 'pointer-events-none opacity-40'
      )}
      onClick={function () {
        props.onClick()
      }}>
      <Icon
        icon={props.icon}
        className={cn(
          'size-3.5',
          props.isSpinning && 'animate-spin motion-reduce:animate-none [animation-duration:0.7s]'
        )}
      />
    </Button>
  )
}

function SearchStatus(props: {
  isSearching: boolean
  fileCount: number
  matchCount: number
}) {
  return (
    <div
      className="text-muted-foreground relative flex h-5 items-center gap-1.5 overflow-hidden px-1 text-[11px]"
      aria-live="polite">
      {props.isSearching ? (
        <>
          <Icon
            icon="lucide:loader-circle"
            className="size-3 shrink-0 animate-spin motion-reduce:animate-none [animation-duration:0.65s]"
          />
          <span className="shimmer motion-reduce:animate-none">正在搜索工作区…</span>
        </>
      ) : (
        <span className="animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none duration-200">
          {props.fileCount} 个文件，{props.matchCount} 个结果
        </span>
      )}
      {props.isSearching ? (
        <span
          aria-hidden
          className="via-primary/70 absolute inset-x-0 bottom-0 h-px overflow-hidden bg-border/40">
          <span className="bg-primary absolute inset-y-0 w-1/3 animate-search-progress motion-reduce:animate-none rounded-full" />
        </span>
      ) : null}
    </div>
  )
}

function FieldShell(props: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-input bg-background focus-within:border-ring flex min-h-7 items-center gap-0.5 rounded-md border px-1',
        props.className
      )}>
      {props.children}
    </div>
  )
}

export { FieldShell, HeaderAction, SearchStatus, ToggleButton }
