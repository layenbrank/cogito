import { resolve } from '@tauri-apps/api/path'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { Icon } from '@iconify/react/offline'

import type { MenuItem } from '@/components/contextmenu'
import { useKnowledgeStore } from '@/stores/knowledge'
import {
  clearDirListCache,
  insertMarkdownFile,
  insertMarkdownFolder,
  removeMarkdownPath,
  renameMarkdownPath
} from '@/views/knowledge/lib/fs.ts'
import {
  findFileName,
  findParentDir,
  isPathInsideRoot,
  isSamePath,
  normalizeSeparators
} from '@/views/knowledge/lib/path.ts'
import {
  makeUntitled,
  ensureRootDir,
  openPath
} from '@/views/knowledge/lib/session.ts'
import { t } from '@/views/knowledge/locale.ts'
import { ROOT_KEY } from '@/views/knowledge/workspace/overlay/use-navigation-tree.ts'

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

async function findAbsoluteFromKey(root: string, treeKey: string): Promise<string> {
  if (treeKey === ROOT_KEY) return root
  const segments = normalizeSeparators(treeKey).split('/').filter(Boolean)
  return resolve(root, ...segments)
}

function useNavigationMutations(onOpenPath: (path: string) => void) {
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const toBumpTree = useKnowledgeStore(function (state) {
    return state.toBumpTree
  })

  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [newTarget, setNewTarget] = useState<NewTarget | null>(null)

  async function onCreateAtRoot() {
    try {
      const root = await ensureRootDir()
      clearDirListCache(root)
      const absolute = await insertMarkdownFile(root, '', `note-${Date.now()}.md`)
      toBumpTree()
      onOpenPath(absolute)
    } catch (error) {
      console.error(error)
      toast.error(t('CREATE_FAILED'))
    }
  }

  async function onConfirmCreate() {
    if (!newTarget) return
    const name = newTarget.name.trim()
    if (!name) return
    try {
      const root = await ensureRootDir()
      if (newTarget.kind === 'folder') {
        await insertMarkdownFolder(root, newTarget.relativeDir, name)
        toBumpTree()
      } else {
        const absolute = await insertMarkdownFile(root, newTarget.relativeDir, name)
        toBumpTree()
        onOpenPath(absolute)
      }
      setNewTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(newTarget.kind === 'folder' ? t('CREATE_FOLDER_FAILED') : t('CREATE_FAILED'))
    }
  }

  async function onConfirmDelete(clearAbsolutePathCache: () => void) {
    if (!pendingDelete || !rootDir) return
    try {
      await removeMarkdownPath(pendingDelete.absolute, rootDir, {
        recursive: pendingDelete.isDirectory
      })
      const current = useKnowledgeStore.getState().activePath
      if (
        current &&
        (isSamePath(current, pendingDelete.absolute) ||
          isPathInsideRoot(pendingDelete.absolute, current))
      ) {
        makeUntitled()
      }
      setPendingDelete(null)
      clearAbsolutePathCache()
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('DELETE'))
    }
  }

  async function onConfirmRename(clearAbsolutePathCache: () => void) {
    if (!renameTarget || !rootDir) return
    const nextName = renameTarget.name.trim()
    if (!nextName) return
    try {
      const parent = findParentDir(renameTarget.absolute)
      const next = `${parent}/${nextName}`
      if (isSamePath(renameTarget.absolute, next)) {
        setRenameTarget(null)
        return
      }
      await renameMarkdownPath(renameTarget.absolute, next, rootDir)
      const state = useKnowledgeStore.getState()
      const current = state.activePath
      if (current) {
        if (isSamePath(current, renameTarget.absolute)) {
          if (state.isDirty) {
            state.toOpenDocument({
              path: next,
              markdown: state.markdown,
              frontMatter: state.frontMatter,
              html: state.html
            })
            state.toMarkDirty(true)
          } else {
            void openPath(next, { force: true })
          }
        } else if (isPathInsideRoot(renameTarget.absolute, current)) {
          const fromNorm = normalizeSeparators(renameTarget.absolute).replace(/\/+$/, '')
          const curNorm = normalizeSeparators(current)
          const suffix = curNorm.slice(fromNorm.length)
          const relocated = `${normalizeSeparators(next).replace(/\/+$/, '')}${suffix}`
          if (state.isDirty) {
            state.toOpenDocument({
              path: relocated,
              markdown: state.markdown,
              frontMatter: state.frontMatter,
              html: state.html
            })
            state.toMarkDirty(true)
          } else {
            void openPath(relocated, { force: true })
          }
        }
      }
      clearAbsolutePathCache()
      setRenameTarget(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('RENAME'))
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
          label: t('NEW_FILE'),
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
              name: `note-${Date.now()}.md`
            })
          }
        },
        {
          key: 'new-folder',
          label: t('NEW_FOLDER'),
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
              name: `folder-${Date.now()}`
            })
          }
        }
      ]

      if (isRoot) return items

      items.push(
        {
          key: 'rename',
          label: t('RENAME'),
          icon: (
            <Icon
              icon="lucide:pencil"
              className="size-3.5"
            />
          ),
          onSelect() {
            void (async function () {
              try {
                const root = await ensureRootDir()
                const absolute = await findAbsoluteFromKey(root, treeKey)
                setRenameTarget({
                  absolute,
                  name: findFileName(absolute),
                  isDirectory
                })
              } catch (error) {
                console.error(error)
                toast.error(t('RENAME'))
              }
            })()
          }
        },
        {
          key: 'delete',
          label: t('DELETE'),
          danger: true,
          icon: (
            <Icon
              icon="lucide:trash-2"
              className="size-3.5"
            />
          ),
          onSelect() {
            void (async function () {
              try {
                const root = await ensureRootDir()
                const absolute = await findAbsoluteFromKey(root, treeKey)
                setPendingDelete({ absolute, isDirectory })
              } catch (error) {
                console.error(error)
                toast.error(t('DELETE'))
              }
            })()
          }
        }
      )

      return items
    },
    []
  )

  return {
    pendingDelete,
    setPendingDelete,
    renameTarget,
    setRenameTarget,
    newTarget,
    setNewTarget,
    onCreateAtRoot,
    onConfirmCreate,
    onConfirmDelete,
    onConfirmRename,
    findTreeMenuItems
  }
}

export { useNavigationMutations }
export type { DeleteTarget, NewTarget, RenameTarget }
