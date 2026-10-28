import { Icon } from '@iconify/react/offline'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { Spinner } from '@cogito/design/components/spinner'
import { cn } from 'cn'
import { memo, useEffect, useRef, useState } from 'react'

export interface FileTreeNode {
  title: string
  key: string
  isLeaf?: boolean
  isDirectory?: boolean
  isLoaded?: boolean
  isLoading?: boolean
  hasMore?: boolean
  isLoadMore?: boolean
  nextOffset?: number
  children?: FileTreeNode[]
}

interface FileTreeItemProps {
  node: FileTreeNode
  depth?: number
  activeKey?: string | null
  expandedKeys?: Set<string>
  emptyHint?: string
  onLoad: (node: FileTreeNode, options?: { force?: boolean; append?: boolean }) => Promise<void>
  onSelect: (node: FileTreeNode) => void
  onExpandChange?: (key: string, open: boolean) => void
}

function isSameTreeKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function rowPadLeft(depth: number): number {
  return 8 + depth * 12
}

/** 「加载更多」行：只有一行文字，点一下继续追加 */
function LoadMoreRow(props: { title: string; depth: number; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={props.onSelect}
        style={{ paddingLeft: rowPadLeft(props.depth) }}
        className="text-muted-foreground hover:bg-muted/60 w-full truncate py-0.75 pr-2 text-left text-sm">
        {props.title}
      </button>
    </li>
  )
}

/** 文件行：没有子节点，点击即打开 */
function FileRow(props: {
  title: string
  depth: number
  isActive: boolean
  treeKey: string
  onSelect: () => void
}) {
  const isActive = props.isActive
  return (
    <li>
      <button
        type="button"
        data-tree-key={props.treeKey}
        data-tree-kind="file"
        aria-current={isActive ? 'page' : undefined}
        onClick={props.onSelect}
        style={{ paddingLeft: rowPadLeft(props.depth) }}
        className={cn(
          'flex w-full items-center gap-1.5 truncate border-l-2 border-transparent py-0.75 pr-2 text-left text-sm transition-colors hover:bg-muted/60',
          isActive && 'border-l-primary bg-primary/15 font-medium text-foreground'
        )}>
        <Icon
          icon={isActive ? 'lucide:file-text' : 'lucide:file'}
          className={cn(
            'size-3.5 shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground opacity-70'
          )}
        />
        <span className="truncate">{props.title}</span>
      </button>
    </li>
  )
}

function FileTreeItemComponent(props: FileTreeItemProps) {
  const node = props.node
  const depth = props.depth ?? 0
  const isActive = isSameTreeKey(props.activeKey, node.key)
  const isDirectory = node.isDirectory ?? !node.isLeaf
  const isControlled = props.expandedKeys !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = isControlled ? props.expandedKeys!.has(node.key) : uncontrolledOpen
  /** 已发起过的加载：外部直接改 expandedKeys 时不会重复拉同一目录 */
  const requestedRef = useRef<Set<string>>(new Set())
  const loadRef = useRef(props.onLoad)

  useEffect(function () {
    loadRef.current = props.onLoad
  })

  // 受控展开（面包屑跳转、刷新恢复）不会走 onOpenChange，这里补一次按需加载
  useEffect(
    function () {
      if (!isDirectory || !isOpen || node.isLoaded || node.isLoading) return
      if (requestedRef.current.has(node.key)) return
      requestedRef.current.add(node.key)
      void loadRef.current(node)
    },
    [isDirectory, isOpen, node]
  )

  if (node.isLoadMore) {
    return (
      <LoadMoreRow
        title={node.title}
        depth={depth}
        onSelect={function () {
          props.onSelect(node)
        }}
      />
    )
  }

  if (!isDirectory) {
    return (
      <FileRow
        title={node.title}
        depth={depth}
        isActive={isActive}
        treeKey={node.key}
        onSelect={function () {
          props.onSelect(node)
        }}
      />
    )
  }

  const hasChildren = Boolean(node.children && node.children.length > 0)
  const isEmptyLoaded = Boolean(node.isLoaded && !node.isLoading && !hasChildren)

  return (
    <li>
      <Collapsible
        open={isOpen}
        onOpenChange={function (open) {
          if (!isControlled) setUncontrolledOpen(open)
          props.onExpandChange?.(node.key, open)
          if (!open) return
          // 假加载（isLoading 但未 isLoaded）时 force 重试，避免永久骨架
          const shouldForce = Boolean(node.isLoading && !node.isLoaded)
          void props.onLoad(node, shouldForce ? { force: true } : undefined)
        }}>
        <CollapsibleTrigger
          data-tree-key={node.key}
          data-tree-kind="directory"
          className={cn(
            'flex w-full items-center gap-1 border-l-2 border-transparent py-0.75 pr-2 text-left text-sm transition-colors hover:bg-muted/60',
            isActive && 'border-l-primary bg-primary/10 font-medium text-foreground'
          )}
          style={{ paddingLeft: rowPadLeft(depth) }}>
          {node.isLoading ? (
            <Spinner className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <Icon
              icon="lucide:chevron-right"
              className={cn(
                'text-muted-foreground size-3.5 shrink-0 opacity-70 transition-transform',
                isOpen && 'rotate-90'
              )}
            />
          )}
          <Icon
            icon="lucide:folder"
            className="text-muted-foreground size-3.5 shrink-0 opacity-80"
          />
          <span className="truncate">{node.title}</span>
        </CollapsibleTrigger>
        {/*
          子节点在 open=true 之后异步灌入。空 Panel 会先把
          --collapsible-panel-height 量成 0，之后 overflow 把子树裁掉。
          有内容再挂载 Panel，避免空高锁定。
          加载中用普通 ul 骨架（不走 CollapsibleContent），防止空高锁死。
        */}
        {isOpen && node.isLoading && !hasChildren ? (
          <ul
            className="list-none py-0.5"
            aria-hidden>
            {[0, 1, 2].map(function (index) {
              return (
                <li
                  key={index}
                  className="py-1 pr-2"
                  style={{ paddingLeft: rowPadLeft(depth + 1) }}>
                  <div
                    className="h-3 animate-pulse rounded bg-muted"
                    style={{ width: `${72 - index * 12}%` }}
                  />
                </li>
              )
            })}
          </ul>
        ) : null}
        {isOpen && isEmptyLoaded ? (
          <ul className="list-none py-0.5">
            <li
              className="text-muted-foreground py-0.75 pr-2 text-xs"
              style={{ paddingLeft: rowPadLeft(depth + 1) }}>
              {props.emptyHint ?? 'Empty'}
            </li>
          </ul>
        ) : null}
        {isOpen && hasChildren ? (
          <CollapsibleContent>
            <ul className="list-none">
              {node.children!.map(function (child) {
                return (
                  <FileTreeItem
                    key={child.key}
                    node={child}
                    depth={depth + 1}
                    activeKey={props.activeKey}
                    expandedKeys={props.expandedKeys}
                    emptyHint={props.emptyHint}
                    onLoad={props.onLoad}
                    onSelect={props.onSelect}
                    onExpandChange={props.onExpandChange}
                  />
                )
              })}
            </ul>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </li>
  )
}

function isFileTreeItemEqual(prev: FileTreeItemProps, next: FileTreeItemProps): boolean {
  if (prev.node !== next.node) return false
  if (prev.depth !== next.depth) return false
  if (prev.expandedKeys !== next.expandedKeys) return false
  if (prev.emptyHint !== next.emptyHint) return false
  if (prev.onLoad !== next.onLoad) return false
  if (prev.onSelect !== next.onSelect) return false
  if (prev.onExpandChange !== next.onExpandChange) return false
  const wasActive = isSameTreeKey(prev.activeKey, prev.node.key)
  const willActive = isSameTreeKey(next.activeKey, next.node.key)
  if (wasActive !== willActive) return false
  // 目录必须向下传递 activeKey，否则子孙选中态会卡在旧值
  const isDirectory = prev.node.isDirectory ?? !prev.node.isLeaf
  if (isDirectory && !isSameTreeKey(prev.activeKey, next.activeKey)) {
    return false
  }
  return true
}

const FileTreeItem = memo(FileTreeItemComponent, isFileTreeItemEqual)

export { FileTreeItem }
