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
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import {
  createCodeFile,
  createCodeFolder,
  findFileName,
  findParentDir,
  isSamePath,
  joinPath,
  listWorkspaceEntries,
  normalizeSeparators,
  pickRootDirectory,
  removeCodePath,
  renameCodePath
} from '@/views/code/lib/fs.ts'
import { disposeModel, relocateModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { findRelativePath, isPathInsideRoot } from '@/views/code/lib/path.ts'
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

interface CreateTarget {
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

function findRelocatedPath(tabPath: string, fromPath: string, toPath: string): string | null {
  if (isSamePath(tabPath, fromPath)) return toPath
  if (!isPathInsideRoot(fromPath, tabPath)) return null
  const fromNorm = normalizeSeparators(fromPath).replace(/\/+$/, '')
  const tabNorm = normalizeSeparators(tabPath)
  const suffix = tabNorm.slice(fromNorm.length)
  return `${normalizeSeparators(toPath).replace(/\/+$/, '')}${suffix}`
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
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null)

  function onSelect(node: FileTreeNode) {
    void (async function () {
      if (node.key === ROOT_KEY) return
      if (node.isDirectory || !node.isLeaf) return
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
          isLeaf: !entry.isDirectory,
          isDirectory: entry.isDirectory
        }
      })
      setTreeNodes(function (origin) {
        return updateFileTreeNodes(origin, node.key, nextChildren)
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取目录失败')
    }
  }

  async function onConfirmCreate() {
    if (!createTarget) return
    const name = createTarget.name.trim()
    if (!name) return
    try {
      if (createTarget.kind === 'folder') {
        await createCodeFolder(props.workspaceRoot, createTarget.relativeDir, name)
        toBumpTree()
      } else {
        const absolute = await createCodeFile(
          props.workspaceRoot,
          createTarget.relativeDir,
          name
        )
        toBumpTree()
        await openAbsolutePath(absolute)
      }
      setCreateTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(
        createTarget.kind === 'folder'
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
        const relocated = findRelocatedPath(tab.path, renameTarget.absolute, next)
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
            setCreateTarget({
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
            setCreateTarget({
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
                onLoad={onLoad}
                onSelect={onSelect}
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
        title={createTarget?.kind === 'folder' ? '新建文件夹' : '新建文件'}
        name={createTarget?.name ?? null}
        onChange={function (name) {
          setCreateTarget(function (prev) {
            if (!prev) return prev
            return { ...prev, name }
          })
        }}
        onCancel={function () {
          setCreateTarget(null)
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
