import { memo, useState } from 'react'

import { FileRow, LoadMoreRow } from '@/views/workspace/overlay/file-tree-rows.tsx'
import { FileTreeDirectoryItem } from '@/views/workspace/overlay/file-tree-directory-item.tsx'
import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import { isSameTreeKey } from '@/views/workspace/overlay/file-tree-utils.ts'

export type { FileTreeNode }

interface FileTreeItemProps {
  node: FileTreeNode
  depth?: number
  activeKey?: string | null
  expandedKeys?: Set<string>
  emptyHint?: string
  onFetch: (node: FileTreeNode, options?: { force?: boolean; append?: boolean }) => Promise<void>
  onSelect: (node: FileTreeNode) => void
  onExpandChange?: (key: string, open: boolean) => void
}

function FileTreeItemComponent(props: FileTreeItemProps) {
  const node = props.node
  const depth = props.depth ?? 0
  const isActive = isSameTreeKey(props.activeKey, node.key)
  const isDirectory = node.isDirectory ?? !node.isLeaf
  const isControlled = props.expandedKeys !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = isControlled ? props.expandedKeys!.has(node.key) : uncontrolledOpen

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

  return (
    <FileTreeDirectoryItem
      node={node}
      depth={depth}
      isActive={isActive}
      isOpen={isOpen}
      isControlled={isControlled}
      onUncontrolledOpen={setUncontrolledOpen}
      activeKey={props.activeKey}
      expandedKeys={props.expandedKeys}
      emptyHint={props.emptyHint}
      onFetch={props.onFetch}
      onSelect={props.onSelect}
      onExpandChange={props.onExpandChange}
    />
  )
}

function isFileTreeItemEqual(prev: FileTreeItemProps, next: FileTreeItemProps): boolean {
  if (prev.node !== next.node) return false
  if (prev.depth !== next.depth) return false
  if (prev.expandedKeys !== next.expandedKeys) return false
  if (prev.emptyHint !== next.emptyHint) return false
  if (prev.onFetch !== next.onFetch) return false
  if (prev.onSelect !== next.onSelect) return false
  if (prev.onExpandChange !== next.onExpandChange) return false
  const wasActive = isSameTreeKey(prev.activeKey, prev.node.key)
  const willActive = isSameTreeKey(next.activeKey, next.node.key)
  if (wasActive !== willActive) return false
  const isDirectory = prev.node.isDirectory ?? !prev.node.isLeaf
  if (isDirectory && !isSameTreeKey(prev.activeKey, next.activeKey)) {
    return false
  }
  return true
}

const FileTreeItem = memo(FileTreeItemComponent, isFileTreeItemEqual)

export { FileTreeItem }
