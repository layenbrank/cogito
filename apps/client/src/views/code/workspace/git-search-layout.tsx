import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'
import type { KeyboardEventHandler, RefObject } from 'react'

import type { SearchField } from '@/lib/workspace-git'
import type { useCodeGitStore } from '@/stores/code-git'
import { GIT_SEARCH_FIELDS } from '@/views/code/workspace/git-search-format.ts'
import { GitSearchChangesPanel } from '@/views/code/workspace/git-search-changes-panel.tsx'
import { GitSearchCommitsPanel } from '@/views/code/workspace/git-search-commits-panel.tsx'
import { BranchSwitcher } from '@/views/code/workspace/scm/branch-switcher.tsx'

type CommitHit = ReturnType<typeof useCodeGitStore.getState>['searchHits'][number]
type CommitFile = ReturnType<typeof useCodeGitStore.getState>['commitFiles'][number]

interface GitSearchLayoutProps {
  draft: string
  searchField: SearchField
  searchHits: CommitHit[]
  searchHasMore: boolean
  searchHitScanCap: boolean
  isSearchLoading: boolean
  isShowLoading: boolean
  searchError: string | null
  showError: string | null
  selectedOid: string | null
  commitFiles: CommitFile[]
  selectedHit: CommitHit | undefined
  filteredFiles: CommitFile[]
  fileFilter: string
  activeFilePath: string | null
  showCommitSkeleton: boolean
  showFileSkeleton: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDraftChange: (value: string) => void
  onRunSearchNow: (nextDraft?: string) => void
  onField: (field: SearchField) => void
  onSelect: (oid: string) => void
  onOpenFile: (relative: string) => void
  onCopySha: (oid: string) => void
  onCommitKeyDown: KeyboardEventHandler<HTMLDivElement>
  onFileFilterChange: (value: string) => void
}

function GitSearchToolbar(props: Pick<
  GitSearchLayoutProps,
  'draft' | 'searchField' | 'isSearchLoading' | 'onDraftChange' | 'onRunSearchNow' | 'onField'
>) {
  return (
    <div className="border-border/50 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <BranchSwitcher
        tone="toolbar"
        className="shrink-0"
      />
      <div className="relative min-w-[14rem] flex-1">
        <Icon
          icon="lucide:search"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        />
        <Input
          value={props.draft}
          placeholder="搜索消息、作者或提交哈希…"
          aria-label="搜索提交"
          className="bg-muted/40 border-border/60 h-9 pl-8 text-sm shadow-none"
          onChange={function (event) {
            props.onDraftChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key !== 'Enter') return
            event.preventDefault()
            props.onRunSearchNow()
          }}
        />
        {props.draft ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="清除搜索"
            className="text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
            onClick={function () {
              props.onDraftChange('')
              props.onRunSearchNow('')
            }}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        ) : null}
      </div>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[props.searchField]}
        className="shrink-0"
        onValueChange={function (value) {
          const next = value[0] as SearchField | undefined
          if (next) props.onField(next)
        }}>
        {GIT_SEARCH_FIELDS.map(function (field) {
          return (
            <ToggleGroupItem
              key={field.id}
              value={field.id}
              className="h-9 px-3 text-sm">
              {field.label}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="刷新"
        title="刷新"
        className="text-muted-foreground size-8 shrink-0"
        disabled={props.isSearchLoading}
        onClick={function () {
          props.onRunSearchNow()
        }}>
        <Icon
          icon="lucide:refresh-cw"
          className={cn('size-4', props.isSearchLoading && 'animate-spin')}
        />
      </Button>
    </div>
  )
}

function GitSearchLayout(props: GitSearchLayoutProps) {
  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <GitSearchToolbar
        draft={props.draft}
        searchField={props.searchField}
        isSearchLoading={props.isSearchLoading}
        onDraftChange={props.onDraftChange}
        onRunSearchNow={props.onRunSearchNow}
        onField={props.onField}
      />

      {(props.searchError || props.showError || props.searchHitScanCap) && (
        <div className="border-border/40 flex shrink-0 flex-col gap-0.5 border-b px-3 py-2">
          {props.searchError || props.showError ? (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <Icon
                icon="lucide:circle-alert"
                className="size-3.5 shrink-0"
              />
              {props.searchError || props.showError}
            </p>
          ) : null}
          {props.searchHitScanCap ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Icon
                icon="lucide:info"
                className="size-3.5 shrink-0"
              />
              已达扫描上限，结果可能不完整
            </p>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <GitSearchCommitsPanel
          draft={props.draft}
          searchHits={props.searchHits}
          searchHasMore={props.searchHasMore}
          selectedOid={props.selectedOid}
          isSearchLoading={props.isSearchLoading}
          showCommitSkeleton={props.showCommitSkeleton}
          listRef={props.listRef}
          onSelect={props.onSelect}
          onCommitKeyDown={props.onCommitKeyDown}
        />
        <GitSearchChangesPanel
          selectedOid={props.selectedOid}
          commitFiles={props.commitFiles}
          selectedHit={props.selectedHit}
          filteredFiles={props.filteredFiles}
          fileFilter={props.fileFilter}
          activeFilePath={props.activeFilePath}
          showFileSkeleton={props.showFileSkeleton}
          isShowLoading={props.isShowLoading}
          onCopySha={props.onCopySha}
          onOpenFile={props.onOpenFile}
          onFileFilterChange={props.onFileFilterChange}
        />
      </div>
    </div>
  )
}

export { GitSearchLayout }
