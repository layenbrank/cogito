/**
 * 右栏文件树：浏览 / 搜索工作区，点选后用 Monaco 完整打开并可编辑。
 * 返回落回进入文件时所在目录，不重置到工作区根。
 * 多根工作区（主目录 + 附加文件夹）在顶部切换根。
 */
import type { useAui } from '@assistant-ui/react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { AsideFilesPreview } from '@/views/agent/chat/components/aside-files-preview'
import { AsideFilesRoots } from '@/views/agent/chat/components/aside-files-roots'
import {
  ASIDE_PATH_TRIGGER,
  buildAsidePathMenuItems,
  findAsidePathAttrs,
  toastAttached
} from '@/views/agent/chat/components/aside-path-menu'
import { useAsideFilesPreview } from '@/views/agent/chat/components/use-aside-files-preview'
import { WorkspaceFilePicker } from '@/views/agent/chat/components/workspace-file-picker'
import { findParentRelative } from '@/views/agent/chat/components/workspace-relative-path.ts'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'

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
        toastAttached(previewRelative)
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  const attachRelative = useCallback(
    function (relative: string) {
      void attachWorkspaceFile(props.aui, relative)
        .then(function () {
          toastAttached(relative)
        })
        .catch(function (cause: unknown) {
          toast.error(cause instanceof Error ? cause.message : '引用失败')
        })
    },
    [props.aui]
  )

  const findPathMenuItems = useCallback(
    function (trigger: Element) {
      if (!activeRoot) return []
      const attrs = findAsidePathAttrs(trigger)
      if (!attrs) return []
      return buildAsidePathMenuItems({
        rootPath: activeRoot,
        relative: attrs.relative,
        onAddToComposer: attachRelative
      })
    },
    [activeRoot, attachRelative]
  )

  function closePreview() {
    updatePreviewRelative(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {previewRelative ? (
        <AsideFilesPreview
          rootPath={activeRoot}
          previewRelative={previewRelative}
          absolutePath={preview.absolutePath}
          isPending={preview.isPending}
          error={preview.error}
          content={preview.content}
          isReadonly={preview.isReadonly}
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
            <AsideFilesRoots
              folders={folders}
              activePath={activeRoot}
              onSelect={switchRoot}
            />
            <ContextMenu
              trigger={ASIDE_PATH_TRIGGER}
              classNames={CODE_MENU_CLASS_NAMES}
              findItems={findPathMenuItems}>
              {/* ContextMenu 只把 onContextMenu/ref 烙到直接子节点；函数组件接不住，必须包一层 DOM */}
              <div className="flex min-h-0 flex-1 flex-col">
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
              </div>
            </ContextMenu>
          </>
        )}
      </div>
    </div>
  )
}

export { AsideFiles }
