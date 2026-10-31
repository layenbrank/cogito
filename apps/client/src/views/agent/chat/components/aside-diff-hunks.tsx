import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useRef } from 'react'

import type { DiffHunk } from '@/lib/workspace-git'

function AsideHunks(props: {
  hunks: DiffHunk[]
  total: number
  added: number
  deleted: number
  isLoading: boolean
  hasMore: boolean
  onMore: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { hasMore, isLoading, onMore } = props

  useEffect(
    function () {
      const node = scrollRef.current
      if (!node) return
      function onScroll() {
        if (!node) return
        const remain = node.scrollHeight - node.scrollTop - node.clientHeight
        if (remain < 160 && hasMore && !isLoading) {
          onMore()
        }
      }
      node.addEventListener('scroll', onScroll, { passive: true })
      return function () {
        node.removeEventListener('scroll', onScroll)
      }
    },
    [hasMore, isLoading, onMore]
  )

  return (
    <div
      ref={scrollRef}
      className="size-full overflow-auto font-mono text-[11px] leading-[16px]">
      <div className="text-muted-foreground border-border sticky top-0 z-[1] border-b bg-background px-2 py-1 text-[10px]">
        +{props.added} / −{props.deleted} · {props.hunks.length}
        {props.total > 0 ? ` / ${props.total}` : ''} 块
      </div>
      {props.hunks.map(function (hunk) {
        const hunkKey = `${hunk.oldStart}:${hunk.newStart}:${hunk.oldLines}:${hunk.newLines}`
        return (
          <div
            key={hunkKey}
            className="border-border border-b">
            <div className="bg-muted/40 text-muted-foreground truncate px-2 py-0.5">
              {hunk.header}
            </div>
            {hunk.lines.map(function (line) {
              const kind = line.charAt(0)
              return (
                <div
                  key={`${hunkKey}:${line}`}
                  className={cn(
                    'px-2 whitespace-pre',
                    kind === '+' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    kind === '-' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  )}>
                  {line}
                </div>
              )
            })}
          </div>
        )
      })}
      {props.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-2 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3 animate-spin"
          />
          加载中…
        </p>
      ) : null}
    </div>
  )
}

export { AsideHunks }
