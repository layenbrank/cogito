/**
 * Code 工作区 · Explorer 扁平虚拟列表。
 *
 * 对齐 VS Code 的做法：DOM 里只有视口内的几十行，滚动条长度由上下占位撑出来。
 * 行高固定（`EXPLORER_ROW_HEIGHT`），所以偏移是纯算术，不需要测量。
 *
 * 不引入 `@tanstack/react-virtual`：行等高、内容单行、交互只有点击与滚动，
 * 这点窗口化逻辑不值得再加一个依赖。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { findFolderIcon } from '@/views/workspace/overlay/file-icon.ts'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import { FileRow } from '@/views/workspace/overlay/file-tree-rows.tsx'
import { isSameTreeKey, rowPadLeft } from '@/views/workspace/overlay/file-tree-utils.ts'
import {
  computeRowWindow,
  findExplorerRowIndex,
  type ExplorerRow
} from '@/views/code/workspace/overlay/explorer-rows.ts'

/**
 * 固定行高：`h-7` = 1.75rem = 28px。
 *
 * 行样式里的 `h-7` 与这里必须一致，否则滚动时会「内容跳动」——这是本层唯一
 * 脆弱点，改动 `file-tree-rows.tsx` 的行高要同步改这里。
 */
const EXPLORER_ROW_HEIGHT = 28

/** 视口上下各多渲染几行，快速滚动时不至于露白 */
const OVERSCAN_ROWS = 6

interface ExplorerFlatListProps {
  rows: ExplorerRow[]
  /** 挂在滚动容器上的 root key（右键菜单用 `[data-tree-key]` 选中树干） */
  rootKey: string
  activeKey: string | null
  emptyHint?: string
  isExpanded: (key: string) => boolean
  onSelect: (node: FileTreeNode) => void
  onExpandChange: (key: string, open: boolean) => void
}

function ExplorerDirectoryRow(props: {
  row: ExplorerRow
  isActive: boolean
  isOpen: boolean
  onToggle: () => void
}) {
  const node = props.row.node
  const folderIcon = findFolderIcon(node.title, props.isOpen)
  return (
    <li>
      <Button
        variant="ghost"
        type="button"
        data-tree-key={props.row.nodeKey}
        data-tree-kind="directory"
        onClick={props.onToggle}
        style={{ paddingLeft: rowPadLeft(props.row.depth) }}
        className={cn(
          'flex h-7 w-full items-center justify-start gap-1.5 truncate py-0 pr-2 text-left text-sm transition-colors hover:bg-muted/60',
          props.isActive && 'bg-primary/10 font-medium text-foreground'
        )}>
        {node.isLoading ? (
          <Spinner className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <Icon
            icon="lucide:chevron-right"
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 opacity-70 transition-transform',
              props.isOpen && 'rotate-90'
            )}
          />
        )}
        <Icon
          icon={folderIcon.icon}
          className={cn('size-3.5 shrink-0', folderIcon.className)}
        />
        <span className="truncate">{node.title}</span>
      </Button>
    </li>
  )
}

function ExplorerFlatList(props: ExplorerFlatListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })

  useEffect(function () {
    const element = scrollRef.current
    if (!element) return
    const scroller: HTMLDivElement = element
    function sync() {
      const next = { scrollTop: scroller.scrollTop, height: scroller.clientHeight }
      setViewport(function (prev) {
        return prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next
      })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    return function () {
      observer.disconnect()
    }
  }, [])

  const activeIndex = useMemo(
    function () {
      return findExplorerRowIndex(props.rows, props.activeKey)
    },
    [props.rows, props.activeKey]
  )

  const rowWindow = computeRowWindow({
    total: props.rows.length,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    rowHeight: EXPLORER_ROW_HEIGHT,
    activeIndex,
    overscan: OVERSCAN_ROWS
  })

  const onScroll = useCallback(function (event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight })
  }, [])

  const visibleRows = props.rows.slice(rowWindow.start, rowWindow.end)

  return (
    <div
      ref={scrollRef}
      data-tree-key={props.rootKey}
      data-tree-kind="directory"
      onScroll={onScroll}
      className="h-full w-full overflow-x-hidden overflow-y-auto text-sm">
      <div style={{ height: rowWindow.topHeight }} aria-hidden />
      <ul className="list-none">
        {visibleRows.map(function (row) {
          if (row.kind === 'empty') {
            return (
              <li
                key={row.key}
                className="text-muted-foreground flex h-7 items-center pr-2 text-xs"
                style={{ paddingLeft: rowPadLeft(row.depth) }}>
                {props.emptyHint ?? 'Empty'}
              </li>
            )
          }
          if (row.kind === 'loadMore') {
            return (
              <Button
                key={row.key}
                variant="ghost"
                type="button"
                data-tree-key={row.nodeKey}
                data-tree-kind="loadMore"
                onClick={function () {
                  props.onSelect(row.node)
                }}
                style={{ paddingLeft: rowPadLeft(row.depth) }}
                className="text-muted-foreground hover:bg-muted/60 flex h-7 w-full justify-start truncate py-0 pr-2 text-left text-sm">
                {row.node.title}
              </Button>
            )
          }
          if (row.kind === 'directory') {
            const isOpen = props.isExpanded(row.nodeKey)
            return (
              <ExplorerDirectoryRow
                key={row.key}
                row={row}
                isActive={isSameTreeKey(row.nodeKey, props.activeKey)}
                isOpen={isOpen}
                onToggle={function () {
                  props.onExpandChange(row.nodeKey, !isOpen)
                }}
              />
            )
          }
          return (
            <FileRow
              key={row.key}
              title={row.node.title}
              depth={row.depth}
              treeKey={row.nodeKey}
              isActive={isSameTreeKey(row.nodeKey, props.activeKey)}
              onSelect={function () {
                props.onSelect(row.node)
              }}
            />
          )
        })}
      </ul>
      <div style={{ height: rowWindow.bottomHeight }} aria-hidden />
    </div>
  )
}

export { EXPLORER_ROW_HEIGHT, OVERSCAN_ROWS, ExplorerFlatList }
