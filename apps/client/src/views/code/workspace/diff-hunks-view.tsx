import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'

import type { DiffHunk } from '@/lib/workspace-git'
import { useCodeGitStore } from '@/stores/code-git'
import { toSideRows, type DiffLayout } from '@/views/code/workspace/diff-host-layout.ts'

function HunkBlock(props: {
  hunk: DiffHunk
  isCollapsed: boolean
  isSideBySide: boolean
  onToggle: () => void
}) {
  const { hunk, isCollapsed, isSideBySide, onToggle } = props
  const sideRows = isSideBySide ? toSideRows(hunk.lines) : null

  return (
    <div className="border-border border-b font-mono text-[12px] leading-[18px]">
      <button
        type="button"
        className="bg-muted/40 text-muted-foreground hover:bg-muted/70 flex w-full items-center gap-2 px-3 py-1 text-left"
        onClick={onToggle}>
        <Icon
          icon={isCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'}
          className="size-3 shrink-0"
        />
        <span className="truncate">{hunk.header}</span>
        <span className="text-muted-foreground/70 ml-auto shrink-0 tabular-nums">
          {hunk.lines.length} 行
        </span>
      </button>
      {isCollapsed ? null : isSideBySide && sideRows ? (
        <div className="grid grid-cols-2 divide-x divide-border">
          <div className="min-w-0 overflow-x-auto">
            {sideRows.map(function (row, index) {
              return (
                <div
                  key={`l-${index}`}
                  className={cn(
                    'px-3 whitespace-pre',
                    (row.tag === 'del' || row.tag === 'mod') &&
                      'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                    row.left === null && 'bg-muted/20 text-transparent'
                  )}>
                  {row.left ?? '\u00a0'}
                </div>
              )
            })}
          </div>
          <div className="min-w-0 overflow-x-auto">
            {sideRows.map(function (row, index) {
              return (
                <div
                  key={`r-${index}`}
                  className={cn(
                    'px-3 whitespace-pre',
                    (row.tag === 'add' || row.tag === 'mod') &&
                      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    row.right === null && 'bg-muted/20 text-transparent'
                  )}>
                  {row.right ?? '\u00a0'}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
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

function HunksView(props: { layout: DiffLayout }) {
  const diff = useCodeGitStore(function (state) {
    return state.diff
  })
  const relative = diff?.relative
  const [collapsed, updateCollapsed] = useState<Record<string, boolean>>({})
  const [collapsedRelative, setCollapsedRelative] = useState(relative)
  if (relative !== collapsedRelative) {
    setCollapsedRelative(relative)
    updateCollapsed({})
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const isSideBySide = props.layout === 'sideBySide'

  useEffect(
    function () {
      const node = scrollRef.current
      if (!node || !diff || diff.mode !== 'hunks') return

      function onScroll() {
        if (!node || !diff) return
        const remain = node.scrollHeight - node.scrollTop - node.clientHeight
        if (remain < 240 && diff.hasMoreHunks && !diff.isHunksLoading) {
          void useCodeGitStore.getState().toLoadMoreHunks()
        }
      }

      node.addEventListener('scroll', onScroll, { passive: true })
      return function () {
        node.removeEventListener('scroll', onScroll)
      }
    },
    [diff]
  )

  if (!diff || diff.mode !== 'hunks') return null

  return (
    <div
      ref={scrollRef}
      className="size-full overflow-auto">
      <div className="text-muted-foreground border-border flex items-center gap-3 border-b px-3 py-1.5 text-[11px]">
        <span>
          +{diff.added} / −{diff.deleted}
        </span>
        <span>
          已加载 {diff.hunks.length}
          {diff.hunkTotal > 0 ? ` / ${diff.hunkTotal}` : ''} 块
        </span>
        <span className="ml-auto">{isSideBySide ? '并排' : '单列'}</span>
      </div>
      {diff.hunks.map(function (hunk) {
        const key = hunk.header
        const isCollapsed = Boolean(collapsed[key])
        return (
          <HunkBlock
            key={key}
            hunk={hunk}
            isCollapsed={isCollapsed}
            isSideBySide={isSideBySide}
            onToggle={function () {
              updateCollapsed(function (prev) {
                return { ...prev, [key]: !prev[key] }
              })
            }}
          />
        )
      })}
      {diff.isHunksLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          加载更多变更块…
        </div>
      ) : null}
      {!diff.isHunksLoading && diff.hunks.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center py-8 text-xs">
          没有可展示的变更块
        </div>
      ) : null}
    </div>
  )
}

export { HunksView }
