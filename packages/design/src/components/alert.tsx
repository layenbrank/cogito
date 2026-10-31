import { cn } from 'cn'
import type { ComponentProps } from 'react'

function Alert({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        'relative w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground',
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-muted-foreground [&_p]:leading-relaxed', className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription }
