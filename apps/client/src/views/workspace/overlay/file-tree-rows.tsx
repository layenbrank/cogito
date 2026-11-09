import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useEffect, useRef } from 'react'

import { findFileIcon } from '@/views/workspace/overlay/file-icon.ts'
import { rowPadLeft } from '@/views/workspace/overlay/file-tree-utils.ts'

function LoadMoreRow(props: { title: string; depth: number; onSelect: () => void }) {
  return (
    <li>
      <Button
        variant="ghost"
        type="button"
        onClick={props.onSelect}
        style={{ paddingLeft: rowPadLeft(props.depth) }}
        className="text-muted-foreground hover:bg-muted/60 flex h-7 w-full justify-start truncate py-0 pr-2 text-left text-sm">
        {props.title}
      </Button>
    </li>
  )
}

function FileRow(props: {
  title: string
  depth: number
  isActive: boolean
  treeKey: string
  onSelect: () => void
  /**
   * 额外挂 `data-aside-path` / `data-aside-kind`：右栏文件树用它接自己的右键菜单
   * （添加到对话 / 复制路径）。代码窗资源管理器用不到，默认关闭。
   */
  emitAsidePath?: boolean
}) {
  const isActive = props.isActive
  const icon = findFileIcon(props.title)
  const rowRef = useRef<HTMLLIElement | null>(null)
  useEffect(
    function () {
      if (!isActive) return
      const frame = window.requestAnimationFrame(function () {
        rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
      return function () {
        window.cancelAnimationFrame(frame)
      }
    },
    [isActive, props.treeKey]
  )
  return (
    <li ref={rowRef}>
      <Button
        variant="ghost"
        type="button"
        data-tree-key={props.treeKey}
        data-tree-kind="file"
        data-aside-path={props.emitAsidePath ? props.treeKey : undefined}
        data-aside-kind={props.emitAsidePath ? 'file' : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={props.onSelect}
        style={{ paddingLeft: rowPadLeft(props.depth) }}
        className={cn(
          'flex h-7 w-full items-center justify-start gap-1.5 truncate py-0 pr-2 text-left text-sm transition-colors hover:bg-muted/60',
          isActive && 'bg-primary/15 font-medium text-foreground'
        )}>
        <Icon
          icon={icon.icon}
          className={cn('size-3.5 shrink-0', icon.className)}
        />
        <span className="truncate">{props.title}</span>
      </Button>
    </li>
  )
}

export { LoadMoreRow, FileRow }
