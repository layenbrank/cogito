import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

function PageHeader(props: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{props.title}</h2>
        {props.description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
    </div>
  )
}

export { PageHeader }
