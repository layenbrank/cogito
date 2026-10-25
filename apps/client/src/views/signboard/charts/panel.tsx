import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

interface ChartPanelProps {
  title: string
  icon: string
  hint?: string
  children: ReactNode
}

function ChartPanel(props: ChartPanelProps) {
  return (
    <section className="rounded-lg border border-border/80 bg-card p-3 shadow-xs">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Icon
            icon={props.icon}
            className="size-3.5 text-muted-foreground"
          />
          {props.title}
        </div>
        {props.hint ? (
          <span className="text-[10px] text-muted-foreground">{props.hint}</span>
        ) : null}
      </header>
      {props.children}
    </section>
  )
}

export { ChartPanel }
