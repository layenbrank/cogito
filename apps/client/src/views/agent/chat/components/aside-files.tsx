/**
 * 右栏文件树：浏览 / 搜索工作区，点选后预览正文。
 * 预览返回落回进入文件时所在目录，不重置到工作区根。
 * 多根工作区在顶部切换「当前文件夹」（与审阅面板共用同一个选择）。
 */
import type { useAui } from '@assistant-ui/react'
import { useState } from 'react'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { AsideFilesPreview } from '@/views/agent/chat/components/aside-files-preview'
import { useAsideFilesPreview } from '@/views/agent/chat/components/use-aside-files-preview'
import { WorkspaceFilePicker } from '@/views/agent/chat/components/workspace-file-picker'
import { WorkspaceFolderChips } from '@/views/agent/chat/components/workspace-folder-chips'
import {
  findBaseName,
  findParentRelative
} from '@/views/agent/chat/components/workspace-relative-path.ts'

type ComposerAui = ReturnType<typeof useAui>

interface AsideFilesProps {
  aui: ComposerAui
  initialRelative?: string | null
  onOpenReview?: (relative: string) => void
}

function AsideFiles(props: AsideFilesProps) {
  const { rootPath: activeRoot, folders } = useActiveWorkspace()
  const revision = useWorkspaceRevision()
  const [directory, updateDirectory] = useState('')
  const [previewRelative, updatePreviewRelative] = useState<string | null>(
    props.initialRelative ?? null
  )
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)

  const preview = useAsideFilesPreview(previewRelative, activeRoot, revision)

  function switchRoot() {
    updateDirectory('')
    updatePreviewRelative(null)
  }

  if (props.initialRelative !== seenInitial) {
    const next = props.initialRelative ?? null
    updateSeenInitial(next)
    updatePreviewRelative(next)
    if (next) updateDirectory(findParentRelative(next))
  }

  function handlePick(relative: string) {
    updateDirectory(findParentRelative(relative))
    updatePreviewRelative(relative)
  }

  function handleDirectoryChange(next: string) {
    updateDirectory(next)
  }

  function handleAttach() {
    if (!previewRelative) return
    void attachWorkspaceFile(props.aui, previewRelative)
      .then(function () {
        toast.success(`已引用 ${findBaseName(previewRelative)}`)
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  function closePreview() {
    updatePreviewRelative(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {previewRelative ? (
        <AsideFilesPreview
          previewRelative={previewRelative}
          isPending={preview.isPending}
          error={preview.error}
          content={preview.content}
          isTruncated={preview.isTruncated}
          charLimit={preview.charLimit}
          onClose={closePreview}
          onAttach={handleAttach}
          onOpenReview={props.onOpenReview}
        />
      ) : null}

      <div
        className={
          previewRelative
            ? 'hidden'
            : !activeRoot
              ? 'text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs'
              : 'flex min-h-0 flex-1 flex-col'
        }>
        {!activeRoot ? (
          '先在左栏添加一个工作区'
        ) : (
          <>
            {folders.length > 1 ? (
              <WorkspaceFolderChips
                className="border-b"
                onSwitch={switchRoot}
              />
            ) : null}
            <WorkspaceFilePicker
              active
              root={activeRoot}
              revision={revision}
              directory={directory}
              onDirectoryChange={handleDirectoryChange}
              className="flex min-h-0 flex-1 flex-col"
              listClassName="min-h-0"
              onPick={handlePick}
            />
          </>
        )}
      </div>
    </div>
  )
}

export { AsideFiles }
