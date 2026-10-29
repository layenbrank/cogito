/**
 * Code 工作区 · 资源管理器：文件树 + 右键新建/重命名/删除。
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import { hint } from '@/views/code/lib/bindings.ts'
import {
  insertCodeFile,
  insertCodeFolder,
  findFileName,
  findParentDir,
  isSamePath,
  joinPath,
  listWorkspaceEntries,
  pickRootDirectory,
  removeCodePath,
  renameCodePath,
  type TreeEntry
} from '@/views/code/lib/fs.ts'
import { disposeModel, relocateModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { findRelativePath, relocatePath } from '@/views/code/lib/path.ts'
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

type CreateKind = 'file' | 'folder'

interface NewTarget {
  kind: CreateKind
  relativeDir: string
  name: string
}

interface RenameTarget {
  absolute: string
  name: string
  isDirectory: boolean
}

interface DeleteTarget {
  absolute: string
  isDirectory: boolean
}

function findRelativeDirForCreate(treeKey: string, isDirectory: boolean): string {
  if (treeKey === ROOT_KEY) return ''
  if (isDirectory) return treeKey
  const parent = treeKey.replace(/[/\\][^/\\]+$/, '')
  return parent === treeKey ? '' : parent
}

function findAbsoluteFromKey(root: string, treeKey: string): string {
  if (treeKey === ROOT_KEY) return root
  return joinPath(root, treeKey)
}

function toTreeNode(entry: TreeEntry): FileTreeNode {
  return {
    title: entry.name,
    key: entry.path,
    isLeaf: !entry.isDirectory,
    isDirectory: entry.isDirectory
  }
}

/** 层级深度：用于让父目录先于子目录重读 */
function countDepth(key: string): number {
  if (key === ROOT_KEY) return 0
  return key.split('/').length
}

/** 丢弃未展开目录的子节点缓存，下次展开时按需重读 */
function pruneCollapsedNodes(nodes: FileTreeNode[], expandedKeys: Set<string>): FileTreeNode[] {
  return nodes.map(function (node) {
    if (!node.children) return node
    const isExpanded = expandedKeys.has(node.key)
    return {
      ...node,
      children: isExpanded ? pruneCollapsedNodes(node.children, expandedKeys) : undefined,
      isLoaded: isExpanded ? node.isLoaded : false
    }
  })
}

function DeleteConfirmDialog(props: {
  target: DeleteTarget | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const target = props.target
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={function (open) {
        if (!open) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.isDirectory ? '删除此文件夹及其内容？' : '删除此文件？'}
          </AlertDialogTitle>
          <AlertDialogDescription>{target?.absolute}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function NameDialog(props: {
  title: string
  name: string | null
  onChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={props.name !== null}
      onOpenChange={function (open) {
        if (!open) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <Input
          value={props.name ?? ''}
          className="h-8"
          placeholder="名称"
          onChange={function (event) {
            props.onChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onConfirm()
            }
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.title}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ExplorerTree(props: ExplorerTreeProps) {
  const toBumpTree = useCodeStore(function (state) {
    return state.toBumpTree
  })
  const treeRevision = useCodeStore(function (state) {
    return state.treeRevision
  })
  const expandedKeys = useCodeStore(function (state) {
    return state.expandedKeys
  })
  const isHiddenVisible = useCodeStore(function (state) {
    return state.isHiddenVisible
  })
  const toToggleExpanded = useCodeStore(function (state) {
    return state.toToggleExpanded
  })

  const expandedSet = useMemo(
    function () {
      return new Set(expandedKeys)
    },
    [expandedKeys]
  )

  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>(function () {
    const folder = props.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? '工作区'
    return [
      {
        title: `${folder} (工作区)`,
        key: ROOT_KEY,
        isDirectory: true
      }
    ]
  })

  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [newTarget, setNewTarget] = useState<NewTarget | null>(null)

  function onSelect(node: FileTreeNode) {
    void (async function () {
      if (node.key === ROOT_KEY) return
      if (node.isDirectory || !node.isLeaf) return
      const absolute = joinPath(props.workspaceRoot, node.key)
      await openAbsolutePath(absolute)
    })()
  }

  async function onFetch(node: FileTreeNode) {
    if (node.children) return
    const relativePath = node.key === ROOT_KEY ? '' : node.key
    try {
      const entries = await listWorkspaceEntries(props.workspaceRoot, relativePath, {
        isHiddenVisible
      })
      const nextChildren: FileTreeNode[] = entries.map(toTreeNode)
      setTreeNodes(function (origin) {
        return updateFileTreeNodes(origin, node.key, nextChildren)
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取目录失败')
    }
  }

  // 磁盘变化后重读「根 + 已展开目录」，不再靠重挂载整棵树（否则展开状态全丢）
  useEffect(
    function () {
      let cancelled = false
      // 展开状态从 store 现取：把它放进依赖会让每次展开/折叠都触发整棵树重读
      const currentExpanded = useCodeStore.getState().expandedKeys
      const currentExpandedSet = new Set(currentExpanded)
      const keys = [ROOT_KEY, ...currentExpanded].sort(function (a, b) {
        return countDepth(a) - countDepth(b)
      })
      void (async function () {
        // 先丢弃未展开目录的缓存，下次展开时按需重读，避免看到旧内容
        setTreeNodes(function (origin) {
          return pruneCollapsedNodes(origin, currentExpandedSet)
        })
        for (const key of keys) {
          const relativePath = key === ROOT_KEY ? '' : key
          try {
            const entries = await listWorkspaceEntries(props.workspaceRoot, relativePath, {
              isHiddenVisible
            })
            if (cancelled) return
            const nextChildren = entries.map(toTreeNode)
            setTreeNodes(function (origin) {
              return updateFileTreeNodes(origin, key, nextChildren)
            })
          } catch (error) {
            if (cancelled) return
            console.debug('[code] refresh tree node skipped', key, error)
          }
        }
      })()
      return function () {
        cancelled = true
      }
    },
    [treeRevision, props.workspaceRoot, isHiddenVisible]
  )

  async function onConfirmCreate() {
    if (!newTarget) return
    const name = newTarget.name.trim()
    if (!name) return
    try {
      if (newTarget.kind === 'folder') {
        await insertCodeFolder(props.workspaceRoot, newTarget.relativeDir, name)
        toBumpTree()
      } else {
        const absolute = await insertCodeFile(
          props.workspaceRoot,
          newTarget.relativeDir,
          name
        )
        toBumpTree()
        await openAbsolutePath(absolute)
      }
      setNewTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(
        newTarget.kind === 'folder'
          ? error instanceof Error
            ? error.message
            : '创建文件夹失败'
          : error instanceof Error
            ? error.message
            : '创建文件失败'
      )
    }
  }

  async function onConfirmDelete() {
    if (!pendingDelete) return
    try {
      await removeCodePath(pendingDelete.absolute, props.workspaceRoot, {
        recursive: pendingDelete.isDirectory
      })
      const closed = useCodeStore.getState().toCloseByPath(pendingDelete.absolute)
      for (const path of closed) {
        disposeModel(path)
      }
      setPendingDelete(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function onConfirmRename() {
    if (!renameTarget) return
    const nextName = renameTarget.name.trim()
    if (!nextName) return
    try {
      const parent = findParentDir(renameTarget.absolute)
      const next = `${parent}/${nextName}`
      if (isSamePath(renameTarget.absolute, next)) {
        setRenameTarget(null)
        return
      }
      await renameCodePath(renameTarget.absolute, next, props.workspaceRoot)

      const store = useCodeStore.getState()
      const snapshot = store.tabs.slice()
      for (const tab of snapshot) {
        const relocated = relocatePath(tab.path, renameTarget.absolute, next)
        if (!relocated) continue
        relocateModel(tab.path, relocated)
      }
      store.toRelocatePath(renameTarget.absolute, next)
      setRenameTarget(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '重命名失败')
    }
  }

  const findTreeMenuItems = useCallback(
    function (trigger: Element): MenuItem[] {
      const treeKey = trigger.getAttribute('data-tree-key')
      if (!treeKey) return []
      const kind = trigger.getAttribute('data-tree-kind')
      const isDirectory = kind === 'directory' || treeKey === ROOT_KEY
      const isRoot = treeKey === ROOT_KEY
      const relativeDir = findRelativeDirForCreate(treeKey, isDirectory)

      const items: MenuItem[] = [
        {
          key: 'new-file',
          label: '新建文件',
          icon: (
            <Icon
              icon="lucide:file-plus-2"
              className="size-3.5"
            />
          ),
          onSelect() {
            setNewTarget({
              kind: 'file',
              relativeDir,
              name: 'untitled.txt'
            })
          }
        },
        {
          key: 'new-folder',
          label: '新建文件夹',
          icon: (
            <Icon
              icon="lucide:folder-plus"
              className="size-3.5"
            />
          ),
          onSelect() {
            setNewTarget({
              kind: 'folder',
              relativeDir,
              name: 'new-folder'
            })
          }
        }
      ]

      if (isRoot) return items

      items.push(
        {
          key: 'rename',
          label: '重命名',
          icon: (
            <Icon
              icon="lucide:pencil"
              className="size-3.5"
            />
          ),
          onSelect() {
            const absolute = findAbsoluteFromKey(props.workspaceRoot, treeKey)
            setRenameTarget({
              absolute,
              name: findFileName(absolute),
              isDirectory
            })
          }
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          icon: (
            <Icon
              icon="lucide:trash-2"
              className="size-3.5"
            />
          ),
          onSelect() {
            const absolute = findAbsoluteFromKey(props.workspaceRoot, treeKey)
            setPendingDelete({ absolute, isDirectory })
          }
        }
      )

      return items
    },
    [props.workspaceRoot]
  )

  return (
    <>
      <ContextMenu
        trigger="[data-tree-key]"
        findItems={findTreeMenuItems}>
        <ul
          data-tree-key={ROOT_KEY}
          data-tree-kind="directory"
          className={cn('h-full w-full list-none overflow-x-hidden overflow-y-auto py-0.5 text-sm')}>
          {treeNodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={props.activeKey}
                expandedKeys={expandedSet}
                onFetch={onFetch}
                onSelect={onSelect}
                onExpandChange={toToggleExpanded}
              />
            )
          })}
        </ul>
      </ContextMenu>

      <DeleteConfirmDialog
        target={pendingDelete}
        onCancel={function () {
          setPendingDelete(null)
        }}
        onConfirm={function () {
          void onConfirmDelete()
        }}
      />

      <NameDialog
        title="重命名"
        name={renameTarget?.name ?? null}
        onChange={function (name) {
          setRenameTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          setRenameTarget(null)
        }}
        onConfirm={function () {
          void onConfirmRename()
        }}
      />

      <NameDialog
        title={newTarget?.kind === 'folder' ? '新建文件夹' : '新建文件'}
        name={newTarget?.name ?? null}
        onChange={function (name) {
          setNewTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          setNewTarget(null)
        }}
        onConfirm={function () {
          void onConfirmCreate()
        }}
      />
    </>
  )
}

function Navigation() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
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
        <p className="opacity-70">{hint('CODE_OPEN_FOLDER', '打开文件夹')}</p>
      </div>
    )
  }

  return (
    <ExplorerTree
      workspaceRoot={workspaceRoot}
      activeKey={activeKey}
    />
  )
}

export default Navigation
