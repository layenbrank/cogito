import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  actionLabel?: string
  onAction?(): void
  children?: ReactNode
}

function EmptyState(props: EmptyStateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-6 py-8 text-center">
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
        <Icon
          icon="lucide:inbox"
          className="size-6"
        />
      </div>
      <p className="text-base font-medium text-foreground">{props.title}</p>
      {props.description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{props.description}</p>
      ) : null}
      {props.onAction && props.actionLabel ? (
        <Button
          size="lg"
          className="mt-2"
          onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      ) : null}
      {props.children}
    </div>
  )
}

export { EmptyState }
