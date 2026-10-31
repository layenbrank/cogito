import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import type { useCodeGitStore } from '@/stores/code-git'
import { GitSearchCommitSummary } from '@/views/code/workspace/git-search-commit-summary.tsx'
import { ChangeStats, SectionHeader } from '@/views/code/workspace/git-search-parts.tsx'
import { GitSearchChangesFiles } from '@/views/code/workspace/git-search-changes-files.tsx'

type CommitHit = ReturnType<typeof useCodeGitStore.getState>['searchHits'][number]
type CommitFile = ReturnType<typeof useCodeGitStore.getState>['commitFiles'][number]

interface GitSearchChangesPanelProps {
  selectedOid: string | null
  commitFiles: CommitFile[]
  selectedHit: CommitHit | undefined
  filteredFiles: CommitFile[]
  fileFilter: string
  activeFilePath: string | null
  showFileSkeleton: boolean
  isShowLoading: boolean
  onCopySha: (oid: string) => void
  onOpenFile: (relative: string) => void
  onFileFilterChange: (value: string) => void
}

function GitSearchChangesPanel(props: GitSearchChangesPanelProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SectionHeader
        title="Changes"
        count={props.commitFiles.length}
        isLoading={props.isShowLoading && props.commitFiles.length > 0}
        trailing={
          props.selectedOid ? (
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="复制完整 SHA"
                title="复制完整 SHA"
                className="text-muted-foreground size-7"
                onClick={function () {
                  props.onCopySha(props.selectedOid!)
                }}>
                <Icon
                  icon="lucide:copy"
                  className="size-3.5"
                />
              </Button>
            </div>
          ) : null
        }
      />
      {props.selectedHit ? (
        <GitSearchCommitSummary
          hit={props.selectedHit}
          onCopySha={props.onCopySha}
        />
      ) : null}
      {props.selectedOid && !props.showFileSkeleton ? (
        <ChangeStats files={props.commitFiles} />
      ) : null}
      <GitSearchChangesFiles
        selectedOid={props.selectedOid}
        commitFiles={props.commitFiles}
        filteredFiles={props.filteredFiles}
        fileFilter={props.fileFilter}
        activeFilePath={props.activeFilePath}
        showFileSkeleton={props.showFileSkeleton}
        onOpenFile={props.onOpenFile}
        onFileFilterChange={props.onFileFilterChange}
      />
    </div>
  )
}

export { GitSearchChangesPanel }
