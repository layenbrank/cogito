import { Icon } from '@iconify/react/offline'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { Spinner } from '@cogito/design/components/spinner'
import { cn } from 'cn'
import { useRef } from 'react'

import { findFolderIcon } from '@/views/workspace/overlay/file-icon.ts'
import { FileTreeItem } from '@/views/workspace/overlay/file-tree-item.tsx'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import { rowPadLeft } from '@/views/workspace/overlay/file-tree-utils.ts'

interface FileTreeDirectoryItemProps {
  node: FileTreeNode
  depth: number
  isActive: boolean
  isOpen: boolean
  isControlled: boolean
  onUncontrolledOpen: (open: boolean) => void
  activeKey?: string | null
  expandedKeys?: Set<string>
  emptyHint?: string
  onFetch: (node: FileTreeNode, options?: { force?: boolean; append?: boolean }) => Promise<void>
  onSelect: (node: FileTreeNode) => void
  onExpandChange?: (key: string, open: boolean) => void
}

function FileTreeDirectoryItem(props: FileTreeDirectoryItemProps) {
  const requestedRef = useRef<Set<string>>(new Set())
  const hasChildren = Boolean(props.node.children && props.node.children.length > 0)
  const isEmptyLoaded = Boolean(
    props.node.isLoaded && !props.node.isLoading && !hasChildren
  )
  const folderIcon = findFolderIcon(props.node.title, props.isOpen)

  function maybeFetch(open: boolean) {
    if (!open || props.node.isLoaded || props.node.isLoading) return
    if (requestedRef.current.has(props.node.key)) return
    requestedRef.current.add(props.node.key)
    const shouldForce = Boolean(props.node.isLoading && !props.node.isLoaded)
    void props.onFetch(props.node, shouldForce ? { force: true } : undefined)
  }

  return (
    <li>
      <Collapsible
        open={props.isOpen}
        onOpenChange={function (open) {
          if (!props.isControlled) props.onUncontrolledOpen(open)
          props.onExpandChange?.(props.node.key, open)
          if (open) requestedRef.current.delete(props.node.key)
          maybeFetch(open)
        }}>
        <CollapsibleTrigger
          data-tree-key={props.node.key}
          data-tree-kind="directory"
          className={cn(
            'flex w-full items-center gap-1 py-0.75 pr-2 text-left text-sm transition-colors hover:bg-muted/60',
            props.isActive && 'bg-primary/10 font-medium text-foreground'
          )}
          style={{ paddingLeft: rowPadLeft(props.depth) }}>
          {props.node.isLoading ? (
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
          <span className="truncate">{props.node.title}</span>
        </CollapsibleTrigger>
        {props.isOpen && props.node.isLoading && !hasChildren ? (
          <ul
            className="list-none py-0.5"
            aria-hidden>
            {[0, 1, 2].map(function (index) {
              return (
                <li
                  key={index}
                  className="py-1 pr-2"
                  style={{ paddingLeft: rowPadLeft(props.depth + 1) }}>
                  <div
                    className="h-3 animate-pulse rounded bg-muted"
                    style={{ width: `${72 - index * 12}%` }}
                  />
                </li>
              )
            })}
          </ul>
        ) : null}
        {props.isOpen && isEmptyLoaded ? (
          <ul className="list-none py-0.5">
            <li
              className="text-muted-foreground py-0.75 pr-2 text-xs"
              style={{ paddingLeft: rowPadLeft(props.depth + 1) }}>
              {props.emptyHint ?? 'Empty'}
            </li>
          </ul>
        ) : null}
        {props.isOpen && hasChildren ? (
          <CollapsibleContent>
            <ul className="list-none">
              {props.node.children!.map(function (child) {
                return (
                  <FileTreeItem
                    key={child.key}
                    node={child}
                    depth={props.depth + 1}
                    activeKey={props.activeKey}
                    expandedKeys={props.expandedKeys}
                    emptyHint={props.emptyHint}
                    onFetch={props.onFetch}
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

export { FileTreeDirectoryItem }
