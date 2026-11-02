/**
 * 右栏文件树：浏览 / 搜索工作区，点选后用 Monaco 完整打开并可编辑。
 * 返回落回进入文件时所在目录，不重置到工作区根。
 *
 * 根目录用的是**全局「当前文件夹」**（`useActiveWorkspace`）：这里再存一份
 * `selectedRoot` 会让文件树和审阅 / 历史 / composer 各看一个目录。
 */
import type { useAui } from '@assistant-ui/react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { toAgentReference } from '@/features/agent/workspace/paths.ts'
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
  const { rootPath: activeRoot, folders, selectRoot, primaryRootPath } = useActiveWorkspace()
  const revision = useWorkspaceRevision()
  const [directory, updateDirectory] = useState('')
  const [previewRelative, updatePreviewRelative] = useState<string | null>(
    props.initialRelative ?? null
  )
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)
  // 切文件夹会换 AgentAside 的 key，整个面板重挂：目录 / 预览自然回到入口，不用在这里清

  const preview = useAsideFilesPreview(previewRelative, activeRoot, revision)

  function switchRoot(next: string) {
    selectRoot(next)
  }

  if (props.initialRelative !== seenInitial) {
    const next = props.initialRelative ?? null
    updateSeenInitial(next)
    updatePreviewRelative(next)
    if (next) updateDirectory(findParentRelative(next))
  }

  function handlePick(pick: { relative: string }) {
    updateDirectory(findParentRelative(pick.relative))
    updatePreviewRelative(pick.relative)
  }

  function handleDirectoryChange(next: string) {
    updateDirectory(next)
  }

  function handleAttach() {
    if (!previewRelative || !activeRoot) return
    // 非主文件夹里的相对路径 agent 解析不了：统一折算成引用路径
    const reference = toAgentReference(activeRoot, previewRelative, primaryRootPath)
    void attachWorkspaceFile(props.aui, reference)
      .then(function () {
        toastAttached(reference)
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  /** 右键菜单给的是引用路径（主文件夹相对 / 其他文件夹绝对），直接挂 */
  const attachReference = useCallback(
    function (reference: string) {
      void attachWorkspaceFile(props.aui, reference)
        .then(function () {
          toastAttached(reference)
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
        agentRoot: primaryRootPath,
        relative: attrs.relative,
        onAddToComposer: attachReference
      })
    },
    [activeRoot, primaryRootPath, attachReference]
  )

  function closePreview() {
    updatePreviewRelative(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 根目录条常驻：预览里也能看出/切换当前是哪个文件夹 */}
      {activeRoot ? (
        <AsideFilesRoots
          folders={folders}
          activePath={activeRoot}
          onSelect={switchRoot}
        />
      ) : null}

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
            : !activeRoot
              ? 'text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs'
              : 'flex min-h-0 flex-1 flex-col'
        }>
        {!activeRoot ? (
          '先在左栏添加一个工作区'
        ) : (
          <>
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
