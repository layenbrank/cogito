import { Icon } from '@iconify/react/offline'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@i-thinking/design/components/collapsible'
import { Spinner } from '@i-thinking/design/components/spinner'
import { cn } from 'cn'
import { memo, useState } from 'react'

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
  onLoad: (node: FileTreeNode, options?: { force?: boolean; append?: boolean }) => Promise<void>
  onSelect: (node: FileTreeNode) => void
  onExpandChange?: (key: string, open: boolean) => void
}

function isSameTreeKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function FileTreeItemComponent(props: FileTreeItemProps) {
  const node = props.node
  const depth = props.depth ?? 0
  const isActive = isSameTreeKey(props.activeKey, node.key)
  const isDirectory = node.isDirectory ?? !node.isLeaf
  const isControlled = props.expandedKeys !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = isControlled ? props.expandedKeys!.has(node.key) : uncontrolledOpen

  const rowPadLeft = 8 + depth * 12

  if (node.isLoadMore) {
    return (
      <li>
        <button
          type="button"
          onClick={function () {
            props.onSelect(node)
          }}
          style={{ paddingLeft: rowPadLeft }}
          className="text-muted-foreground hover:bg-muted/60 w-full truncate py-[3px] pr-2 text-left text-[13px]">
          {node.title}
        </button>
      </li>
    )
  }

  if (!isDirectory) {
    return (
      <li>
        <button
          type="button"
          aria-current={isActive ? 'page' : undefined}
          onClick={function () {
            props.onSelect(node)
          }}
          style={{ paddingLeft: rowPadLeft }}
          className={cn(
            'flex w-full items-center gap-1.5 truncate border-l-2 border-transparent py-[3px] pr-2 text-left text-[13px] transition-colors hover:bg-muted/60',
            isActive &&
              'border-l-primary bg-primary/15 font-medium text-foreground'
          )}>
          <Icon
            icon={
              isActive ? 'lucide:file-text' : 'lucide:file'
            }
            className={cn(
              'size-3.5 shrink-0',
              isActive ? 'text-primary' : 'text-muted-foreground opacity-70'
            )}
          />
          <span className="truncate">{node.title}</span>
        </button>
      </li>
    )
  }

  return (
    <li>
      <Collapsible
        open={isOpen}
        onOpenChange={function (open) {
          if (!isControlled) setUncontrolledOpen(open)
          props.onExpandChange?.(node.key, open)
          if (open) void props.onLoad(node)
        }}>
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center gap-1 border-l-2 border-transparent py-[3px] pr-2 text-left text-[13px] transition-colors hover:bg-muted/60',
            isActive && 'border-l-primary bg-primary/10 font-medium text-foreground'
          )}
          style={{ paddingLeft: rowPadLeft }}>
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
        <CollapsibleContent>
          {isOpen && node.children && node.children.length > 0 ? (
            <ul className="list-none">
              {node.children.map(function (child) {
                return (
                  <FileTreeItem
                    key={child.key}
                    node={child}
                    depth={depth + 1}
                    activeKey={props.activeKey}
                    expandedKeys={props.expandedKeys}
                    onLoad={props.onLoad}
                    onSelect={props.onSelect}
                    onExpandChange={props.onExpandChange}
                  />
                )
              })}
            </ul>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function isFileTreeItemEqual(
  prev: FileTreeItemProps,
  next: FileTreeItemProps
): boolean {
  if (prev.node !== next.node) return false
  if (prev.depth !== next.depth) return false
  if (prev.expandedKeys !== next.expandedKeys) return false
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
