/**
 * 工作区文件选择器：Composer `+` 双栏「工作区」面板复用。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { WorkspaceFiles, type DirEntry } from '@/lib/workspace-files.ts'

interface WorkspaceFilePickerProps {
  onPick: (relative: string) => void
  className?: string
  listClassName?: string
  active: boolean
  onBack?: () => void
}

interface PickerEntry {
  name: string
  kind: string
  relative: string
}

/** 列表区：加载中 / 无工作区 / 条目 / 空目录，各自独立成分支分支渲染 */
function PickerList(props: {
  isPending: boolean
  hasWorkspace: boolean
  isSearching: boolean
  entries: readonly PickerEntry[]
  listClassName?: string
  onPick: (relative: string) => void
  onEnterDirectory: (relative: string) => void
}) {
  if (props.isPending) {
    return (
      <PickerListShell listClassName={props.listClassName}>
        <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      </PickerListShell>
    )
  }

  if (!props.hasWorkspace) {
    return (
      <PickerListShell listClassName={props.listClassName}>
        <p className="text-muted-foreground p-2.5 text-xs">先在左栏添加工作区</p>
      </PickerListShell>
    )
  }

  if (props.entries.length === 0) {
    return (
      <PickerListShell listClassName={props.listClassName}>
        <p className="text-muted-foreground p-2.5 text-xs">
          {props.isSearching ? '没有匹配的文件' : '此目录为空'}
        </p>
      </PickerListShell>
    )
  }

  return (
    <PickerListShell listClassName={props.listClassName}>
      {props.entries.map(function (entry) {
        const isDir = entry.kind === 'dir'
        return (
          <Button
            key={entry.relative}
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
            onClick={function () {
              if (isDir) {
                props.onEnterDirectory(entry.relative)
                return
              }
              props.onPick(entry.relative)
            }}>
            <Icon
              icon={isDir ? 'lucide:folder' : 'lucide:file'}
              className="text-muted-foreground size-3.5 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-start">{entry.name}</span>
          </Button>
        )
      })}
    </PickerListShell>
  )
}

function PickerListShell(props: { children: React.ReactNode; listClassName?: string }) {
  return (
    <div
      className={clsx(
        'min-h-0 flex-1 overflow-y-auto p-1.5',
        props.listClassName
      )}>
      {props.children}
    </div>
  )
}

function WorkspaceFilePicker(props: WorkspaceFilePickerProps) {
  const { primaryPath } = useActiveWorkspace()
  const [relative, updateRelative] = useState('')
  const [query, updateQuery] = useState('')
  const [wasActive, setWasActive] = useState(props.active)
  // 收起后再打开要回到干净状态：渲染期按 prop 变化调整（React 推荐写法），不用 effect
  if (props.active !== wasActive) {
    setWasActive(props.active)
    if (!props.active) {
      updateRelative('')
      updateQuery('')
    }
  }
  const [entriesState, updateEntries] = useState<PickerEntry[]>([])
  const [isPending, updatePending] = useState(false)
  /** 没开或没有工作区时按空列表渲染：不在 effect 里同步清 state */
  const entries = props.active && primaryPath ? entriesState : []

  const isSearching = query.trim().length > 0
  const parentRelative = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
  const canGoUp = !isSearching && relative.length > 0
  const canReturn = !isSearching && !relative && Boolean(props.onBack)

  useEffect(
    function () {
      if (!props.active || !primaryPath) return
      let cancelled = false
      const needle = query.trim()

      async function load() {
        try {
          updatePending(true)
          const rows =
            needle.length > 0
              ? (await WorkspaceFiles.search([primaryPath as string], needle, 40)).hits.map(
                  function (hit) {
                    return { name: hit.name, kind: 'file', relative: hit.relative }
                  }
                )
              : (await WorkspaceFiles.listDir(primaryPath as string, relative)).map(
                  function (row: DirEntry) {
                    return { name: row.name, kind: row.kind, relative: row.relative }
                  }
                )
          if (!cancelled) updateEntries(rows)
        } catch (error) {
          console.warn('[workspace-file-picker] 列目录/搜索失败:', error)
          if (!cancelled) updateEntries([])
        } finally {
          if (!cancelled) updatePending(false)
        }
      }

      void load()

      return function () {
        cancelled = true
      }
    },
    [props.active, primaryPath, relative, query]
  )

  function enterDirectory(next: string) {
    updateRelative(next)
    updateQuery('')
  }

  return (
    <div className={props.className}>
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        {canGoUp ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="返回上级目录"
            onClick={function () {
              updateRelative(parentRelative)
            }}>
            <Icon icon="lucide:chevron-left" />
          </Button>
        ) : null}
        <Input
          autoFocus
          value={query}
          placeholder="搜索当前项目文件"
          aria-label="搜索当前项目文件"
          className="h-7 text-xs"
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
      </div>

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
        hasWorkspace={Boolean(primaryPath)}
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
