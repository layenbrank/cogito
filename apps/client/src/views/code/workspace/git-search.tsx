/**
 * 编辑器独立页「搜索提交」（GitLens Commits 式标签）
 */
import { EmptyState } from '@/views/code/workspace/git-search-parts.tsx'
import { GitSearchLayout } from '@/views/code/workspace/git-search-layout.tsx'
import { useGitSearch } from '@/views/code/workspace/use-git-search.ts'

function GitSearch() {
  const state = useGitSearch()

  if (!state.workspaceRoot) {
    return (
      <EmptyState
        icon="lucide:folder-open"
        title="尚未打开文件夹"
        hint="打开工作区后即可搜索提交历史"
      />
    )
  }

  if (!state.isRepo) {
    return (
      <EmptyState
        icon="lucide:git-branch"
        title="当前文件夹不是 Git 仓库"
        hint="在仓库根目录打开文件夹后重试"
      />
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
