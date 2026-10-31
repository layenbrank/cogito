import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import type { KeyboardEventHandler, RefObject } from 'react'

import { useCodeGitStore } from '@/stores/code-git'
import { CommitRow, EmptyState, LoadingRows, SectionHeader } from '@/views/code/workspace/git-search-parts.tsx'

type CommitHit = ReturnType<typeof useCodeGitStore.getState>['searchHits'][number]

interface GitSearchCommitsPanelProps {
  draft: string
  searchHits: CommitHit[]
  searchHasMore: boolean
  selectedOid: string | null
  isSearchLoading: boolean
  showCommitSkeleton: boolean
  listRef: RefObject<HTMLDivElement | null>
  onSelect: (oid: string) => void
  onCommitKeyDown: KeyboardEventHandler<HTMLDivElement>
}

function GitSearchCommitsPanel(props: GitSearchCommitsPanelProps) {
  return (
    <div className="border-border/50 flex min-h-0 min-w-0 flex-[1.15] flex-col border-b lg:border-r lg:border-b-0">
      <SectionHeader
        title="Commits"
        count={props.searchHits.length}
        isLoading={props.isSearchLoading && props.searchHits.length > 0}
        trailing={
          props.draft.trim() ? (
            <span className="text-muted-foreground max-w-40 truncate text-xs">
              “{props.draft.trim()}”
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">最近提交</span>
          )
        }
      />
      <div
        ref={props.listRef}
        tabIndex={0}
        role="listbox"
        aria-label="提交列表"
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-inset"
        onKeyDown={props.onCommitKeyDown}>
        {props.showCommitSkeleton ? <LoadingRows count={6} /> : null}
        {!props.showCommitSkeleton && props.searchHits.length === 0 ? (
          <EmptyState
            icon="lucide:search-x"
            title={props.draft.trim() ? '无匹配提交' : '暂无提交'}
            hint={
              props.draft.trim()
                ? '试试更短的关键词，或切换作用域'
                : '仓库还没有任何提交记录'
            }
          />
        ) : null}
        {!props.showCommitSkeleton && props.searchHits.length > 0 ? (
          <ul className="flex flex-col py-0.5">
            {props.searchHits.map(function (hit, index) {
              return (
                <CommitRow
                  key={hit.oid}
                  hit={hit}
                  isActive={hit.oid === props.selectedOid}
                  isFirst={index === 0}
                  isLast={index === props.searchHits.length - 1 && !props.searchHasMore}
                  onSelect={props.onSelect}
                />
              )
            })}
          </ul>
        ) : null}
        {props.searchHasMore ? (
          <div className="flex justify-center border-t border-border/30 p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-9 gap-1.5 text-sm"
              disabled={props.isSearchLoading}
              onClick={function () {
                void useCodeGitStore.getState().toLoadMoreSearch()
              }}>
              {props.isSearchLoading ? (
                <Icon
                  icon="lucide:loader-circle"
                  className="size-4 animate-spin"
                />
              ) : (
                <Icon
                  icon="lucide:chevrons-down"
                  className="size-4"
                />
              )}
              加载更多
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { GitSearchCommitsPanel }
