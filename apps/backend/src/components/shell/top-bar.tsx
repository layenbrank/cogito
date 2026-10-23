import { Button } from '@cogito/design/components/button'
import { Kbd } from '@cogito/design/components/kbd'
import { Icon } from '@iconify/react/offline'
import { useLocation } from 'react-router-dom'

import { RailToggle } from '@/components/shell/rail-toggle.tsx'
import { findNavItem } from '@/constants/nav.ts'

interface TopBarProps {
  isRailCollapsed: boolean
  onToggleRail(): void
  onOpenCommand(): void
}

function TopBar(props: TopBarProps) {
  const location = useLocation()
  const item = findNavItem(location.pathname)
  const group = item?.group ?? '控制台'
  const title = item?.label ?? '页面'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-[var(--backend-surface)]/80 px-3 backdrop-blur-sm lg:px-4">
      <div className="flex min-w-0 items-center gap-2.5 text-sm">
        <RailToggle
          isCollapsed={props.isRailCollapsed}
          onToggle={function () {
            props.onToggleRail()
          }}
        />
        <span className="text-muted-foreground">{group}</span>
        <Icon
          icon="lucide:chevron-right"
          className="size-4 shrink-0 text-muted-foreground/70"
        />
        <span className="truncate text-[0.9375rem] font-medium text-foreground">{title}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-10 w-56 justify-start gap-2 px-3 text-muted-foreground sm:w-64 md:w-72"
        onClick={function () {
          props.onOpenCommand()
        }}>
        <Icon
          icon="lucide:search"
          className="size-4 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-left">跳转页面、菜单…</span>
        <Kbd className="ms-auto hidden shrink-0 sm:inline-flex">⌘K</Kbd>
      </Button>
    </header>
  )
}

export { TopBar }
