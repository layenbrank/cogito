import { lazy, Suspense } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

const BoardView = lazy(function () {
  return import('@/views/signboard/board-view.tsx').then(function (module) {
    return { default: module.BoardView }
  })
})

export default function Signboard() {
  return (
    <Decorations
      summary={findComponentLabel('signboard')}
      scrollable={false}>
      <div className="mt-stage">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          }>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <BoardView />
          </div>
        </Suspense>
      </div>
    </Decorations>
  )
}
