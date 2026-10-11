import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-item.tsx'

function updateFileTreeNodes(
  list: FileTreeNode[],
  key: string,
  children: FileTreeNode[]
): FileTreeNode[] {
  return list.map(function (node) {
    if (node.key === key) {
      return {
        ...node,
        children
      }
    }
    if (node.children) {
      return {
        ...node,
        children: updateFileTreeNodes(node.children, key, children)
      }
    }
    return node
  })
}

export { updateFileTreeNodes }
