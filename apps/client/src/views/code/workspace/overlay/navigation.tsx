import { Button } from '@i-thinking/design/components/button'
import { cn } from 'cn'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { joinPath, listWorkspaceEntries, pickRootDirectory } from '@/views/code/lib/fs.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { findRelativePath } from '@/views/code/lib/path.ts'
import {
  FileTreeItem,
  type FileTreeNode
} from '@/views/workspace/overlay/file-tree-item.tsx'
import { updateFileTreeNodes } from '@/views/workspace/overlay/file-tree.ts'

const ROOT_KEY = 'ROOT'

interface ExplorerTreeProps {
  workspaceRoot: string
  activeKey: string | null
}

function ExplorerTree(props: ExplorerTreeProps) {
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>(function () {
    const folder = props.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? '工作区'
    return [
      {
        title: `${folder} (工作区)`,
        key: ROOT_KEY
      }
    ]
  })

  function onSelect(node: FileTreeNode) {
    void (async function () {
      if (node.key === ROOT_KEY) return
      if (!node.isLeaf) return
      const absolute = joinPath(props.workspaceRoot, node.key)
      await openAbsolutePath(absolute)
    })()
  }

  async function onLoad(node: FileTreeNode) {
    if (node.children) return
    const relativePath = node.key === ROOT_KEY ? '' : node.key
    try {
      const entries = await listWorkspaceEntries(props.workspaceRoot, relativePath)
      const nextChildren: FileTreeNode[] = entries.map(function (entry) {
        return {
          title: entry.name,
          key: entry.path,
          isLeaf: !entry.isDirectory
        }
      })
      setTreeNodes(function (origin) {
        return updateFileTreeNodes(origin, node.key, nextChildren)
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取目录失败')
    }
  }

  return (
    <ul className={cn('h-full w-full list-none overflow-x-hidden overflow-y-auto py-0.5 text-sm')}>
      {treeNodes.map(function (node) {
        return (
          <FileTreeItem
            key={node.key}
            node={node}
            activeKey={props.activeKey}
            onLoad={onLoad}
            onSelect={onSelect}
          />
        )
      })}
    </ul>
  )
}

function Navigation() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const treeRevision = useCodeStore(function (state) {
    return state.treeRevision
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })

  const activeKey = useMemo(
    function () {
      const activeTab = tabs.find(function (tab) {
        return tab.id === activeTabId
      })
      if (!activeTab || !workspaceRoot) return null
      return findRelativePath(workspaceRoot, activeTab.path) || null
    },
    [tabs, activeTabId, workspaceRoot]
  )

  if (!workspaceRoot) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-xs">
        <p>尚未打开文件夹</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={function () {
            void (async function () {
              const root = await pickRootDirectory()
              if (!root) return
              useCodeStore.getState().toSetWorkspaceRoot(root)
              useCodeStore.getState().toBumpTree()
              useCodeStore.getState().toSetSidebarView('explorer')
              toast.success('已打开文件夹')
            })()
          }}>
          打开文件夹
        </Button>
        <p className="opacity-70">Ctrl+O</p>
      </div>
    )
  }

  return (
    <ExplorerTree
      key={`${workspaceRoot}:${treeRevision}`}
      workspaceRoot={workspaceRoot}
      activeKey={activeKey}
    />
  )
}

export default Navigation
