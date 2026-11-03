/**
 * 多根工作区：文件树顶部的根目录切换条。
 * 与历史 / 审阅共用 `WorkspaceFolderChips` 视觉，避免两套样式漂移。
 */
import { WorkspaceFolderChips } from '@/views/agent/chat/components/workspace-folder-chips'
import type { WorkspaceFolder } from '@/stores/agent.ts'

interface AsideFilesRootsProps {
  folders: readonly WorkspaceFolder[]
  activePath: string | null
  onSelect: (path: string) => void
}

function AsideFilesRoots(props: AsideFilesRootsProps) {
  if (props.folders.length <= 1) return null
  return (
    <WorkspaceFolderChips
      value={props.activePath}
      onSelect={props.onSelect}
    />
  )
}

export { AsideFilesRoots }
