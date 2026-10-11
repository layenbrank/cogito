import { documentDir, resolve } from '@tauri-apps/api/path'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { cn } from 'cn'
import { useState } from 'react'

import {
  FileTreeItem,
  type FileTreeNode
} from '@/views/workspace/overlay/file-tree-item.tsx'
import { updateFileTreeNodes } from '@/views/workspace/overlay/file-tree.ts'

const ROOT_KEY = 'ROOT'

interface NavigationProps {
  onUpdateFragment?: (fragment: string) => void
}

export default function Navigation(props: NavigationProps) {
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([
    {
      title: 'Documents',
      key: ROOT_KEY
    }
  ])

  function onSelect(node: FileTreeNode) {
    void (async function () {
      if (node.key === ROOT_KEY) return
      const documentPath = await documentDir()
      const repath = await resolve('.', documentPath, node.key)
      console.log('Selected path:', repath)
      const fragment = await readTextFile(repath)
      props.onUpdateFragment?.(fragment)
    })()
  }

  async function onLoad(node: FileTreeNode) {
    if (node.children) return

    const documentPath = await documentDir()
    const relativePath = node.key === ROOT_KEY ? '' : node.key
    const repath = await resolve('.', documentPath, relativePath)
    const entries = await readDir(repath)
    console.log('Directory entries for', repath, entries)

    const nextChildren: FileTreeNode[] = entries.map(function (entry) {
      const childKey = relativePath ? `${relativePath}/${entry.name}` : entry.name

      return {
        title: entry.name,
        key: childKey,
        isLeaf: !entry.isDirectory
      }
    })

    setTreeNodes(function (origin) {
      return updateFileTreeNodes(origin, node.key, nextChildren)
    })
  }

  return (
    <ul className={cn('h-full w-full list-none overflow-x-hidden overflow-y-auto p-1 text-sm')}>
      {treeNodes.map(function (node) {
        return (
          <FileTreeItem
            key={node.key}
            node={node}
            onLoad={onLoad}
            onSelect={onSelect}
          />
        )
      })}
    </ul>
  )
}
