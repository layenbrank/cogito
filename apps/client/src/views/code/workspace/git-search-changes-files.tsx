import type { useCodeGitStore } from '@/stores/code-git'
import { GitSearchChangesFilter } from '@/views/code/workspace/git-search-changes-filter.tsx'
import { GitSearchChangesList } from '@/views/code/workspace/git-search-changes-list.tsx'

type CommitFile = ReturnType<typeof useCodeGitStore.getState>['commitFiles'][number]

interface GitSearchChangesFilesProps {
  selectedOid: string | null
  commitFiles: CommitFile[]
  filteredFiles: CommitFile[]
  fileFilter: string
  activeFilePath: string | null
  showFileSkeleton: boolean
  onOpenFile: (relative: string) => void
  onFileFilterChange: (value: string) => void
}

function GitSearchChangesFiles(props: GitSearchChangesFilesProps) {
  const showFilter = Boolean(props.selectedOid && !props.showFileSkeleton)

  return (
    <>
      {showFilter ? (
        <GitSearchChangesFilter
          fileFilter={props.fileFilter}
          onFileFilterChange={props.onFileFilterChange}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <GitSearchChangesList
          selectedOid={props.selectedOid}
          commitFiles={props.commitFiles}
          filteredFiles={props.filteredFiles}
          activeFilePath={props.activeFilePath}
          showFileSkeleton={props.showFileSkeleton}
          onOpenFile={props.onOpenFile}
        />
      </div>
    </>
  )
}

export { GitSearchChangesFiles }
