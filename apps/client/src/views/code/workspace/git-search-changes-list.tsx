import type { useCodeGitStore } from '@/stores/code-git'
import {
  EmptyState,
  FileRow,
  LoadingRows
} from '@/views/code/workspace/git-search-parts.tsx'

type CommitFile = ReturnType<typeof useCodeGitStore.getState>['commitFiles'][number]

interface GitSearchChangesListProps {
  selectedOid: string | null
  commitFiles: CommitFile[]
  filteredFiles: CommitFile[]
  activeFilePath: string | null
  showFileSkeleton: boolean
  onOpenFile: (relative: string) => void
}

function GitSearchChangesList(props: GitSearchChangesListProps) {
  if (!props.selectedOid) {
    return (
      <EmptyState
        icon="lucide:file-diff"
        title="选择一个提交"
        hint="左侧点选后，这里会列出该提交的文件变更"
      />
    )
  }
  if (props.showFileSkeleton) return <LoadingRows count={5} />
  if (props.commitFiles.length === 0) {
    return (
      <EmptyState
        icon="lucide:file-x"
        title="没有文件变更"
        hint="该提交可能是空提交或仅改动了元数据"
      />
    )
  }
  if (props.filteredFiles.length === 0) {
    return (
      <EmptyState
        icon="lucide:search-x"
        title="无匹配文件"
        hint="试试更短的路径片段"
      />
    )
  }
  return (
    <ul className="flex flex-col">
      {props.filteredFiles.map(function (file) {
        return (
          <FileRow
            key={`${file.status}:${file.path}`}
            file={file}
            isActive={file.path === props.activeFilePath}
            onOpen={props.onOpenFile}
          />
        )
      })}
    </ul>
  )
}

export { GitSearchChangesList }
