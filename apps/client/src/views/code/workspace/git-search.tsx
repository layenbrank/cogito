/**
 * 编辑器独立页「搜索提交」（GitLens Commits 式标签）
 */
import { EmptyState } from '@/views/code/workspace/git-search-parts.tsx'
import { GitSearchLayout } from '@/views/code/workspace/git-search-layout.tsx'
import { RepoSwitcher } from '@/views/code/workspace/scm/repo-switcher.tsx'
import { useGitSearch } from '@/views/code/workspace/use-git-search.ts'

function GitSearch() {
  const state = useGitSearch()

  if (!state.isRepo) {
    const hasRoots = state.roots.length > 0
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* 仓库条常驻：没仓库时也要能在这里换一个，否则用户只能回资源管理器 */}
        <div className="border-border/50 flex h-9 shrink-0 items-center border-b px-1.5">
          <RepoSwitcher className="min-w-0 flex-1" />
        </div>
        <EmptyState
          icon={hasRoots ? 'lucide:git-branch' : 'lucide:folder-open'}
          title={hasRoots ? '当前工作区没有 Git 仓库' : '尚未打开文件夹'}
          hint={
            hasRoots
              ? '用上方仓库选择器切到其它文件夹'
              : '打开工作区后即可搜索提交历史'
          }
        />
      </div>
    )
  }

  return (
    <GitSearchLayout
      draft={state.draft}
      searchField={state.searchField}
      searchHits={state.searchHits}
      searchHasMore={state.searchHasMore}
      searchHitScanCap={state.searchHitScanCap}
      isSearchLoading={state.isSearchLoading}
      isShowLoading={state.isShowLoading}
      searchError={state.searchError}
      showError={state.showError}
      selectedOid={state.selectedOid}
      commitFiles={state.commitFiles}
      selectedHit={state.selectedHit}
      filteredFiles={state.filteredFiles}
      fileFilter={state.fileFilter}
      activeFilePath={state.activeFilePath}
      showCommitSkeleton={state.showCommitSkeleton}
      showFileSkeleton={state.showFileSkeleton}
      listRef={state.listRef}
      onDraftChange={state.updateDraft}
      onRunSearchNow={state.runSearchNow}
      onField={state.onField}
      onSelect={state.onSelect}
      onOpenFile={state.onOpenFile}
      onCopySha={state.onCopySha}
      onCommitKeyDown={state.onCommitKeyDown}
      onFileFilterChange={state.updateFileFilter}
    />
  )
}

export { GitSearch }
