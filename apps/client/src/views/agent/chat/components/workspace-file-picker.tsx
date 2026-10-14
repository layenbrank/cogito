/**
 * 工作区文件选择器：Composer `+` 双栏「工作区」面板复用。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
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

function WorkspaceFilePicker(props: WorkspaceFilePickerProps) {
  const { primaryPath } = useActiveWorkspace()
  const [relative, updateRelative] = useState('')
  const [query, updateQuery] = useState('')
  const [entriesState, updateEntries] = useState<Array<{ name: string; kind: string; relative: string }>>(
    []
  )
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
        updatePending(true)
        try {
          const rows =
            needle.length > 0
              ? (await WorkspaceFiles.search([primaryPath as string], needle, 40)).map(function (
                  hit
                ) {
                  return { name: hit.name, kind: 'file', relative: hit.relative }
                })
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

  useEffect(
    function () {
      if (!props.active) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 收起时清掉浏览位置/搜索词，重开才是干净状态（输入态不能改成纯派生）
        updateRelative('')
        updateQuery('')
      }
    },
    [props.active]
  )

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

      <div className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5', props.listClassName)}>
        {isPending ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}
        {!isPending && !primaryPath ? (
          <p className="text-muted-foreground p-2.5 text-xs">先在左栏添加工作区</p>
        ) : null}
        {!isPending && primaryPath
          ? entries.map(function (entry) {
              const isDir = entry.kind === 'dir'
              return (
                <Button
                  key={entry.relative}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
                  onClick={function () {
                    if (isDir) {
                      updateRelative(entry.relative)
                      updateQuery('')
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
            })
          : null}
        {!isPending && primaryPath && entries.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {isSearching ? '没有匹配的文件' : '此目录为空'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { WorkspaceFilePicker }
