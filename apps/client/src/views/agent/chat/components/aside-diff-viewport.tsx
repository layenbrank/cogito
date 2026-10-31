import { cn } from 'cn'
import type { RefObject } from 'react'

import type { DiffHunk, DiffMeta } from '@/lib/workspace-git'
import { AsideDiffOverlays } from '@/views/agent/chat/components/aside-diff-overlays'
import { AsideHunks } from '@/views/agent/chat/components/aside-diff-hunks'

function AsideDiffViewport(props: {
  hostRef: RefObject<HTMLDivElement | null>
  showSide: boolean
  isPending: boolean
  isHunks: boolean
  meta: DiffMeta | null
  error: string | null
  hunks: DiffHunk[]
  hunkTotal: number
  isHunksLoading: boolean
  onMoreHunks: () => void
}) {
  const hasMore = props.hunks.length < props.hunkTotal
  const showHunks = props.isHunks && !props.isPending && !props.meta?.isBinary

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={props.hostRef}
        className={cn('size-full', (!props.showSide || props.isPending) && 'hidden')}
      />
      {showHunks ? (
        <AsideHunks
          hunks={props.hunks}
          total={props.hunkTotal}
          added={props.meta?.added ?? 0}
          deleted={props.meta?.deleted ?? 0}
          isLoading={props.isHunksLoading}
          hasMore={hasMore}
          onMore={props.onMoreHunks}
        />
      ) : null}
      <AsideDiffOverlays
        isPending={props.isPending}
        error={props.error}
        meta={props.meta}
      />
    </div>
  )
}

export { AsideDiffViewport }
