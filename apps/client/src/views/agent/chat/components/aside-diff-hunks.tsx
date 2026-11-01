/**
 * 大改动 hunk 列表：布局对齐 Code 的 HunksView（窄栏固定单列）。
 * 字号与 Code 编辑器默认一致（13 / 行高约 20）。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'

import type { DiffHunk } from '@/lib/workspace-git'

function HunkBlock(props: {
  hunk: DiffHunk
  isCollapsed: boolean
  onToggle: () => void
}) {
  const { hunk, isCollapsed, onToggle } = props

  return (
    <div className="border-border border-b font-mono text-[13px] leading-5">
      <button
        type="button"
        className="bg-muted/40 text-muted-foreground hover:bg-muted/70 flex w-full items-center gap-2 px-3 py-1.5 text-left"
        onClick={onToggle}>
        <Icon
          icon={isCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'}
          className="size-3.5 shrink-0"
        />
        <span className="truncate">{hunk.header}</span>
        <span className="text-muted-foreground/70 ml-auto shrink-0 text-xs tabular-nums">
          {hunk.lines.length} 行
        </span>
      </button>
      {isCollapsed ? null : (
        <pre className="overflow-x-auto px-0 py-0 whitespace-pre">
          {hunk.lines.map(function (line, index) {
            const kind = line.charAt(0)
            const body = line.slice(1)
            return (
              <div
                key={`${hunk.header}-${index}`}
                className={cn(
                  'px-3',
                  kind === '+' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  kind === '-' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                  kind === ' ' && 'text-foreground/80'
                )}>
                <span className="text-muted-foreground/50 mr-2 inline-block w-3 select-none">
                  {kind === ' ' ? '\u00a0' : kind}
                </span>
                {body}
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}

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
  const [collapsed, updateCollapsed] = useState<Record<string, boolean>>({})

  useEffect(
    function () {
      const node = scrollRef.current
      if (!node) return
      function onScroll() {
        if (!node) return
        const remain = node.scrollHeight - node.scrollTop - node.clientHeight
        if (remain < 240 && hasMore && !isLoading) {
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
      className="size-full overflow-auto">
      <div className="text-muted-foreground border-border sticky top-0 z-[1] flex items-center gap-3 border-b bg-background px-3 py-1.5 text-xs">
        <span>
          +{props.added} / −{props.deleted}
        </span>
        <span>
          已加载 {props.hunks.length}
          {props.total > 0 ? ` / ${props.total}` : ''} 块
        </span>
        <span className="ml-auto">单列</span>
      </div>
      {props.hunks.map(function (hunk) {
        const key = hunk.header
        return (
          <HunkBlock
            key={key}
            hunk={hunk}
            isCollapsed={Boolean(collapsed[key])}
            onToggle={function () {
              updateCollapsed(function (prev) {
                return { ...prev, [key]: !prev[key] }
              })
            }}
          />
        )
      })}
      {props.isLoading ? (
        <p className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          加载更多变更块…
        </p>
      ) : null}
      {!props.isLoading && props.hunks.length === 0 ? (
        <p className="text-muted-foreground flex items-center justify-center py-8 text-xs">
          没有可展示的变更块
        </p>
      ) : null}
    </div>
  )
}

export { AsideHunks }
