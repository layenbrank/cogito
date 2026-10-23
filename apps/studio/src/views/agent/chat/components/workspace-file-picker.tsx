import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { cn } from 'cn'
import { useState } from 'react'

import {
  useActiveWorkspaceID,
  useDirEntries,
  useWorkspaceSearch
} from '@/features/agent/workspace/client.ts'

/**
 * 工作区文件选择器：`+` 双栏「工作区」面板复用。
 *
 * 选中的路径怎么落成附件由 `features/agent/attachment.ts` 统一负责。
 */

interface WorkspaceFilePickerProps {
  /** 选完后的动作；由调用方决定（加附件等） */
  onPick: (relative: string) => void
  /** 弹出层内不需要外边框与圆角 */
  className?: string
  /** 列表区域额外 class（双栏里用 flex-1 替代固定 max-height） */
  listClassName?: string
  /** 打开时才拉数据，避免菜单一渲染就发 IPC */
  active: boolean
  /**
   * 在根目录时是否给出「返回」。
   * 双栏 `+` 一般不需要；单页入口可用来回上层。
   */
  onBack?: () => void
}

function findParentLabel(relative: string, name: string) {
  if (relative === name) return ''
  const suffix = `/${name}`
  if (relative.endsWith(suffix)) return relative.slice(0, -suffix.length)
  return relative
}

function WorkspaceFilePicker(props: WorkspaceFilePickerProps) {
  const workspaceID = useActiveWorkspaceID()
  const [relative, updateRelative] = useState('')
  const [query, updateQuery] = useState('')

  const dir = useDirEntries(props.active ? workspaceID : null, relative)
  const search = useWorkspaceSearch(props.active ? workspaceID : null, query)
  const isSearching = query.trim().length > 0
  const isPending = dir.isFetching || search.isFetching

  const entries = isSearching
    ? (search.data ?? []).map(function (hit) {
        return { name: hit.name, kind: 'file' as const, relative: hit.relative }
      })
    : (dir.data ?? [])

  const parentRelative = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
  const canGoUp = !isSearching && relative.length > 0
  const canReturn = !isSearching && !relative && Boolean(props.onBack)

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
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-1.5 border-b px-2.5 py-1.5 text-start text-xs"
          onClick={props.onBack}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5 shrink-0"
          />
          返回工作区列表
        </button>
      ) : null}

      {!isSearching && relative ? (
        <p className="text-muted-foreground truncate px-2.5 pt-1.5 text-xs">{relative}</p>
      ) : null}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5',
          props.listClassName
        )}>
        {isPending ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}

        {!isPending
          ? entries.map(function (entry) {
              const isDir = entry.kind === 'dir'
              const parentLabel = findParentLabel(entry.relative, entry.name)

              return (
                <Tooltip key={entry.relative}>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full min-w-0 shrink justify-start gap-2 px-2 py-1.5 text-xs font-normal"
                        onClick={function () {
                          if (isDir) {
                            updateRelative(entry.relative)
                            return
                          }
                          props.onPick(entry.relative)
                        }}>
                        {isDir ? (
                          <Icon
                            icon="lucide:folder"
                            className="text-muted-foreground size-3.5 shrink-0"
                          />
                        ) : (
                          <Icon
                            icon="lucide:file"
                            className="text-muted-foreground size-3.5 shrink-0"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-start">{entry.name}</span>
                        {parentLabel ? (
                          <span className="text-muted-foreground max-w-[40%] shrink truncate text-end text-xs">
                            {parentLabel}
                          </span>
                        ) : null}
                      </Button>
                    }
                  />
                  <TooltipContent
                    side="top"
                    className="max-w-sm text-start wrap-break-word">
                    {entry.relative}
                  </TooltipContent>
                </Tooltip>
              )
            })
          : null}

        {!isPending && entries.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {isSearching ? '没有匹配的文件' : workspaceID ? '这个目录是空的' : '先在左栏添加工作区'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { WorkspaceFilePicker }
export type { WorkspaceFilePickerProps }
