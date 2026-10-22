import { Button } from '@i-thinking/design/components/button'
import { Skeleton } from '@i-thinking/design/components/skeleton'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

import { findFriendlyError } from '@/utils/http/friendly.ts'

interface QueryStateProps {
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  onRetry?(): void
  skeletonRows?: number
  children: ReactNode
}

function QueryState(props: QueryStateProps) {
  if (props.isLoading) {
    const rows = props.skeletonRows ?? 5
    return (
      <div className="flex min-h-0 flex-1 flex-col space-y-2.5 p-4">
        {Array.from({ length: rows }, function (_, index) {
          return (
            <Skeleton
              key={index}
              className="h-11 w-full shrink-0"
            />
          )
        })}
      </div>
    )
  }

  if (props.isError) {
    const err = findFriendlyError(props.error)
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-6 py-8 text-center">
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
          <Icon
            icon="lucide:cloud-off"
            className="size-6"
          />
        </div>
        <p className="text-base font-medium text-foreground">加载失败</p>
        <p className="max-w-sm text-sm text-muted-foreground">{err.message}</p>
        {err.traceId ? (
          <p className="font-mono text-xs text-muted-foreground/80">链路 {err.traceId}</p>
        ) : null}
        {props.onRetry ? (
          <Button
            size="lg"
            variant="outline"
            className="mt-2 h-10 px-4"
            onClick={function () {
              props.onRetry?.()
            }}>
            重试
          </Button>
        ) : null}
      </div>
    )
  }

  return <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
}

export { QueryState }
