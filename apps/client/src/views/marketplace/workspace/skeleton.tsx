import { Skeleton } from '@cogito/design/components/skeleton'
import { useContext } from 'react'

import {
  MarketplaceContext,
  type MarketplaceMode
} from '@/views/marketplace/workspace/context.tsx'

const BOOT_ROWS = 6
const NAVIGATE_ROWS = 6
const CHIP_ITEMS = 6

type ModeSkeletonProps = {
  mode?: MarketplaceMode
}

function ChipsSkeleton() {
  return (
    <div className="py-2">
      <div className="flex h-10 w-full gap-1 overflow-hidden rounded-full bg-muted p-1.5">
        {Array.from({ length: CHIP_ITEMS }).map(function (_, index) {
          return (
            <Skeleton
              key={index}
              className="h-7 w-14 shrink-0 rounded-full"
            />
          )
        })}
      </div>
    </div>
  )
}

function BoothRows() {
  return (
    <div className="grid w-full auto-rows-min content-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
      {Array.from({ length: BOOT_ROWS }).map(function (_, index) {
        return (
          <div
            key={index}
            className="flex aspect-[4/5] flex-col overflow-hidden rounded-2xl bg-card shadow-sm">
            <Skeleton className="min-h-0 w-full flex-1 rounded-none" />
            <div className="flex shrink-0 flex-col gap-2.5 border-t border-border/40 p-3">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function NavigateRows() {
  return (
    <div className="grid grid-cols-1 gap-2.5 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-3">
      {Array.from({ length: NAVIGATE_ROWS }).map(function (_, index) {
        return (
          <div
            key={index}
            className="flex min-h-22 items-start gap-3 rounded-2xl bg-card p-3.5 shadow-sm">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-5 w-8 rounded-full" />
              <Skeleton className="size-7" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CustomizeSkeleton() {
  return (
    <div className="flex flex-1 gap-4 p-4 max-md:flex-col">
      <div className="flex w-full max-w-[28rem] flex-col gap-3 rounded-2xl bg-card p-6 shadow-sm">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="aspect-video min-w-0 flex-1 rounded-2xl shadow-md" />
    </div>
  )
}

function ModeSkeleton(props: ModeSkeletonProps) {
  const mode = props.mode ?? 'booth'

  if (mode === 'customize') {
    return <CustomizeSkeleton />
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col px-4 pt-1 pb-4">
      <ChipsSkeleton />
      {mode === 'navigate' ? <NavigateRows /> : <BoothRows />}
    </div>
  )
}

/** mode 切换时按当前 mode 镜像 */
function PageSkeleton() {
  const { mode } = useContext(MarketplaceContext)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <ModeSkeleton mode={mode} />
    </div>
  )
}

export { PageSkeleton }
