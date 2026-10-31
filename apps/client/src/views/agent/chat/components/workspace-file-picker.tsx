/**
 * 工作区文件选择器：Composer `+` 双栏「工作区」面板与右栏文件树复用。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceFilePickerEntries } from '@/views/agent/chat/components/use-workspace-file-picker-entries'
import { PickerList } from '@/views/agent/chat/components/workspace-file-picker-list'
import { DirectoryTrail } from '@/views/agent/chat/components/workspace-file-picker-trail'
import { WorkspaceFilePickerToolbar } from '@/views/agent/chat/components/workspace-file-picker-toolbar'
import { findParentRelative } from '@/views/agent/chat/components/workspace-relative-path.ts'

interface WorkspaceFilePickerProps {
  onPick: (relative: string) => void
  className?: string
  listClassName?: string
  active: boolean
  onBack?: () => void
  /** 受控当前目录（相对路径）；与 onDirectoryChange 成对使用 */
  directory?: string
  onDirectoryChange?: (relative: string) => void
  /** 根目录；缺省用工作区主目录（多根工作区由调用方切换） */
  root?: string | null
  /** 工作区版本号：分支切换后重新列目录 */
  revision?: number
}

function WorkspaceFilePicker(props: WorkspaceFilePickerProps) {
  const { rootPath: workspaceRoot } = useActiveWorkspace()
  const root = props.root ?? workspaceRoot
  const isControlled =
    props.directory !== undefined && typeof props.onDirectoryChange === 'function'
  const [innerRelative, updateInnerRelative] = useState('')
  const relative = isControlled ? (props.directory as string) : innerRelative

  function writeRelative(next: string) {
    if (isControlled) {
      props.onDirectoryChange?.(next)
      return
    }
    updateInnerRelative(next)
  }

  const [query, updateQuery] = useState('')
  const [wasActive, setWasActive] = useState(props.active)
  if (props.active !== wasActive) {
    setWasActive(props.active)
    if (!props.active) {
      if (!isControlled) updateInnerRelative('')
      updateQuery('')
    }
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

  return (
    <div className={props.className}>
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
          className="text-muted-foreground h-auto w-full justify-start gap-1.5 rounded-none border-b px-2.5 py-1.5 text-xs font-normal"
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
        onPick={props.onPick}
        onEnterDirectory={enterDirectory}
      />
    </div>
  )
}

export { WorkspaceFilePicker }
