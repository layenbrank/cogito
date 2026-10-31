/**
 * 右栏文件树：浏览 / 搜索工作区，点选后预览正文。
 * 预览返回落回进入文件时所在目录，不重置到工作区根。
 * 多根工作区（主目录 + 附加文件夹）在顶部切换根。
 */
import type { useAui } from '@assistant-ui/react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { AsideFilesPreview } from '@/views/agent/chat/components/aside-files-preview'
import { useAsideFilesPreview } from '@/views/agent/chat/components/use-aside-files-preview'
import { WorkspaceFilePicker } from '@/views/agent/chat/components/workspace-file-picker'
import {
  findBaseName,
  findParentRelative
} from '@/views/agent/chat/components/workspace-relative-path.ts'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

type ComposerAui = ReturnType<typeof useAui>

interface AsideFilesProps {
  aui: ComposerAui
  initialRelative?: string | null
  onOpenReview?: (relative: string) => void
}

function AsideFiles(props: AsideFilesProps) {
  const { rootPath: workspaceRoot, folders } = useActiveWorkspace()
  const revision = useWorkspaceRevision()
  const [selectedRoot, updateSelectedRoot] = useState<string | null>(null)
  const [directory, updateDirectory] = useState('')
  const [previewRelative, updatePreviewRelative] = useState<string | null>(
    props.initialRelative ?? null
  )
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)

  /** 选中的根失效（文件夹被移除）时回落到工作区第一个文件夹 */
  const activeRoot = useMemo(
    function () {
      if (
        selectedRoot &&
        folders.some(function (folder) {
          return folder.path === selectedRoot
        })
      ) {
        return selectedRoot
      }
      return workspaceRoot
    },
    [selectedRoot, folders, workspaceRoot]
  )

  const preview = useAsideFilesPreview(previewRelative, activeRoot, revision)

  function switchRoot(next: string) {
    updateSelectedRoot(next)
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
            : !workspaceRoot
              ? 'text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs'
              : 'flex min-h-0 flex-1 flex-col'
        }>
        {!workspaceRoot ? (
          '先在左栏添加一个工作区'
        ) : (
          <>
            {folders.length > 1 ? (
              <div className="border-border flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {folders.map(function (folder) {
                  const isActive = folder.path === activeRoot
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      title={folder.path}
                      onClick={function () {
                        switchRoot(folder.path)
                      }}
                      className={clsx(
                        'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                        isActive
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}>
                      <Icon
                        icon="lucide:folder"
                        className="size-3.5 shrink-0"
                      />
                      {findBaseName(folder.path)}
                    </button>
                  )
                })}
              </div>
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
