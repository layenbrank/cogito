import { Button } from '@i-thinking/design/components/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { Input } from '@i-thinking/design/components/input'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useMarkdownStore } from '@/stores/markdown'
import {
  createMarkdownFile,
  listMarkdownEntries,
  removeMarkdownPath,
  renameMarkdownPath,
  type TreeEntry
} from '@/views/markdown/lib/fs.ts'
import { joinPath } from '@/views/markdown/lib/path.ts'
import { ensureRootDir } from '@/views/markdown/lib/session.ts'
import { t } from '@/views/markdown/locale.ts'
import {
  FileTreeItem,
  type FileTreeNode
} from '@/views/workspace/overlay/file-tree-item.tsx'
import { updateFileTreeNodes } from '@/views/workspace/overlay/file-tree.ts'

const ROOT_KEY = 'ROOT'

interface NavigationProps {
  fileQuery: string
  onOpenPath(path: string): void
}

function Navigation(props: NavigationProps) {
  const rootDir = useMarkdownStore(function (state) {
    return state.rootDir
  })
  const activePath = useMarkdownStore(function (state) {
    return state.activePath
  })
  const treeRevision = useMarkdownStore(function (state) {
    return state.treeRevision
  })
  const toBumpTree = useMarkdownStore(function (state) {
    return state.toBumpTree
  })

  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([
    { title: 'Workspace', key: ROOT_KEY }
  ])
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{
    absolute: string
    name: string
  } | null>(null)

  useEffect(
    function () {
      void ensureRootDir()
    },
    []
  )

  useEffect(
    function () {
      setTreeNodes([{ title: 'Workspace', key: ROOT_KEY }])
    },
    [rootDir, treeRevision]
  )

  async function onLoad(node: FileTreeNode) {
    if (node.children) return
    const root = await ensureRootDir()
    const relative = node.key === ROOT_KEY ? '' : node.key
    const entries: TreeEntry[] = await listMarkdownEntries(root, relative)
    const query = props.fileQuery.trim().toLowerCase()
    const filtered = query
      ? entries.filter(function (entry) {
          return entry.isDirectory || entry.name.toLowerCase().includes(query)
        })
      : entries

    const nextChildren: FileTreeNode[] = filtered.map(function (entry) {
      return {
        title: entry.name,
        key: entry.path,
        isLeaf: !entry.isDirectory
      }
    })

    setTreeNodes(function (origin) {
      return updateFileTreeNodes(origin, node.key, nextChildren)
    })
  }

  function onSelect(node: FileTreeNode) {
    if (node.key === ROOT_KEY || !node.isLeaf) return
    void (async function () {
      const root = await ensureRootDir()
      const absolute = joinPath(root, node.key)
      props.onOpenPath(absolute)
    })()
  }

  async function onCreate() {
    try {
      const root = await ensureRootDir()
      const absolute = await createMarkdownFile(root, '', `note-${Date.now()}.md`)
      toBumpTree()
      props.onOpenPath(absolute)
    } catch (error) {
      console.error(error)
      toast.error(t('CREATE_FAILED'))
    }
  }

  async function onConfirmDelete() {
    if (!pendingDelete || !rootDir) return
    try {
      await removeMarkdownPath(pendingDelete, rootDir)
      setPendingDelete(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('DELETE'))
    }
  }

  async function onConfirmRename() {
    if (!renameTarget || !rootDir) return
    try {
      const parent = renameTarget.absolute.replace(/[/\\][^/\\]+$/, '')
      const next = `${parent}/${renameTarget.name}`
      await renameMarkdownPath(renameTarget.absolute, next, rootDir)
      setRenameTarget(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('RENAME'))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 flex-1 text-xs"
          onClick={function () {
            void onCreate()
          }}>
          {t('NEW_FILE')}
        </Button>
      </div>
      <ul className={cn('min-h-0 flex-1 list-none overflow-x-hidden overflow-y-auto p-1 text-sm')}>
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
      {activePath ? (
        <div className="flex gap-1 border-t border-border p-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs"
            onClick={function () {
              const name = activePath.split(/[/\\]/).pop() ?? 'note.md'
              setRenameTarget({ absolute: activePath, name })
            }}>
            {t('RENAME')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs text-destructive"
            onClick={function () {
              setPendingDelete(activePath)
            }}>
            {t('DELETE')}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={function (open) {
          if (!open) setPendingDelete(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('DELETE_CONFIRM')}</AlertDialogTitle>
            <AlertDialogDescription>{pendingDelete}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void onConfirmDelete()
              }}>
              {t('DELETE')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={renameTarget !== null}
        onOpenChange={function (open) {
          if (!open) setRenameTarget(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('RENAME')}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renameTarget?.name ?? ''}
            className="h-8"
            onChange={function (event) {
              setRenameTarget(function (prev) {
                if (!prev) return prev
                return { ...prev, name: event.target.value }
              })
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void onConfirmRename()
              }}>
              {t('RENAME')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default Navigation
