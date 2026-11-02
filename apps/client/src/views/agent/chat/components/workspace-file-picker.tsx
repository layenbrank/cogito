/**
 * 工作区文件选择器：Composer `+` 双栏「工作区」面板与右栏文件树复用。
 *
 * `showRoots` 打开顶部的文件夹 chips：多根工作区里可以直接翻到别的项目，
 * 选中项通过 `onPick({ root, relative })` 带上归属根 —— 引用路径由调用方折算
 * （`toAgentPath`），因为「相对哪个根」是这里独有的信息。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceFilePickerEntries } from '@/views/agent/chat/components/use-workspace-file-picker-entries'
import { PickerList } from '@/views/agent/chat/components/workspace-file-picker-list'
import { DirectoryTrail } from '@/views/agent/chat/components/workspace-file-picker-trail'
import { WorkspaceFilePickerToolbar } from '@/views/agent/chat/components/workspace-file-picker-toolbar'
import { WorkspaceFolderChips } from '@/views/agent/chat/components/workspace-folder-chips'
import { findParentRelative } from '@/views/agent/chat/components/workspace-relative-path.ts'

/** 选中项：`relative` 相对 `root`，只在这一个根下成立 */
interface WorkspacePick {
  root: string
  relative: string
}

interface WorkspaceFilePickerProps {
  onPick: (pick: WorkspacePick) => void
  className?: string
  listClassName?: string
  active: boolean
  onBack?: () => void
  /** 受控当前目录（相对路径）；与 onDirectoryChange 成对使用 */
  directory?: string
  onDirectoryChange?: (relative: string) => void
  /** 根目录；缺省用工作区当前文件夹 */
  root?: string | null
  /** 工作区版本号：分支切换后重新列目录 */
  revision?: number
  /** 顶部显示工作区文件夹切换（`+` 面板用；文件树自己已经有根目录条） */
  showRoots?: boolean
}

function WorkspaceFilePicker(props: WorkspaceFilePickerProps) {
  const { rootPath: workspaceRoot, folderPaths } = useActiveWorkspace()
  const [pickedRoot, updatePickedRoot] = useState<string | null>(null)
  const [innerRelative, updateInnerRelative] = useState('')
  const [query, updateQuery] = useState('')
  const [wasActive, setWasActive] = useState(props.active)

  const root =
    props.root ?? (pickedRoot && folderPaths.includes(pickedRoot) ? pickedRoot : workspaceRoot)
  const isDirectoryControlled =
    props.directory !== undefined && typeof props.onDirectoryChange === 'function'
  const relative = isDirectoryControlled ? (props.directory as string) : innerRelative

  /** 只在「根换了」时清空浏览位置：切到别的项目还停在上个项目的子目录是错的 */
  const [lastRoot, updateLastRoot] = useState(root)
  if (root !== lastRoot) {
    updateLastRoot(root)
    if (!isDirectoryControlled) updateInnerRelative('')
    updateQuery('')
  }

  if (props.active !== wasActive) {
    setWasActive(props.active)
    if (!props.active) {
      if (!isDirectoryControlled) updateInnerRelative('')
      updateQuery('')
      // 「只看别的项目」不该粘住上次的选择：下次打开从当前文件夹开始
      updatePickedRoot(null)
    }
  }

  function writeRelative(next: string) {
    if (isDirectoryControlled) {
      props.onDirectoryChange?.(next)
      return
    }
    updateInnerRelative(next)
  }

  const { entries, isPending } = useWorkspaceFilePickerEntries(
    props.active,
    root,
    relative,
    query,
    props.revision ?? 0
  )

  const isSearching = query.trim().length > 0
  const parentRelative = findParentRelative(relative)
  const canGoUp = !isSearching && relative.length > 0
  const canReturn = !isSearching && !relative && Boolean(props.onBack)

  function enterDirectory(next: string) {
    writeRelative(next)
    updateQuery('')
  }

  function switchRoot(next: string) {
    updatePickedRoot(next)
    writeRelative('')
    updateQuery('')
  }

  return (
    <div className={props.className}>
      {props.showRoots ? (
        <WorkspaceFolderChips
          value={root}
          onSelect={switchRoot}
        />
      ) : null}

      <WorkspaceFilePickerToolbar
        relative={relative}
        query={query}
        canGoUp={canGoUp}
        onQueryChange={updateQuery}
        onGoUp={function () {
          writeRelative(parentRelative)
        }}
      />

      {!isSearching ? (
        <DirectoryTrail
          relative={relative}
          onJump={function (path) {
            writeRelative(path)
          }}
        />
      ) : null}

      {canReturn ? (
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground h-auto w-full justify-start gap-1.5 rounded-none border-b px-2.5 py-2 text-[13px] leading-snug font-normal"
          onClick={props.onBack}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5 shrink-0"
          />
          返回
        </Button>
      ) : null}

      <PickerList
        isPending={isPending}
        hasWorkspace={Boolean(workspaceRoot)}
        isSearching={isSearching}
        entries={entries}
        listClassName={props.listClassName}
        onPick={function (next) {
          if (!root) return
          props.onPick({ root, relative: next })
        }}
        onEnterDirectory={enterDirectory}
      />
    </div>
  )
}

export { WorkspaceFilePicker }
export type { WorkspacePick }
