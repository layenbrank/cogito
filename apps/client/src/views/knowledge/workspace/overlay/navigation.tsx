/**
 * Markdown 工作区 · 左侧文件导航：搜索/新建工具条 + 文件树 + 右键新建/重命名/删除。
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { resolve } from '@tauri-apps/api/path'
import { cn } from 'cn'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useKnowledgeStore } from '@/stores/knowledge'
import {
  clearDirListCache,
  createMarkdownFile,
  createMarkdownFolder,
  removeMarkdownPath,
  renameMarkdownPath
} from '@/views/knowledge/lib/fs.ts'
import { findFileName, findParentDir, isPathInsideRoot, normalizeSeparators } from '@/views/knowledge/lib/path.ts'
import { createUntitled, ensureRootDir, openPath } from '@/views/knowledge/lib/session.ts'
import { t } from '@/views/knowledge/locale.ts'
import { FileTreeItem } from '@/views/workspace/overlay/file-tree-item.tsx'
import {
  ROOT_KEY,
  useNavigationTree
} from '@/views/knowledge/workspace/overlay/use-navigation-tree.ts'

interface NavigationProps {
  onOpenPath: (path: string) => void
}

type CreateKind = 'file' | 'folder'

interface CreateTarget {
  kind: CreateKind
  /** 相对工作区的父目录；根为 '' */
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

function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
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

/** 删除确认：只展示待删路径 */
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
            {target?.isDirectory ? t('DELETE_FOLDER_CONFIRM') : t('DELETE_CONFIRM')}
          </AlertDialogTitle>
          <AlertDialogDescription>{target?.absolute}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{t('DELETE')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 重命名 / 新建名称：单行输入 */
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
          placeholder={t('CREATE_NAME')}
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
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.title}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Navigation(props: NavigationProps) {
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const treeRevision = useKnowledgeStore(function (state) {
    return state.treeRevision
  })
  const toBumpTree = useKnowledgeStore(function (state) {
    return state.toBumpTree
  })
  const fileQuery = useKnowledgeStore(function (state) {
    return state.fileQuery
  })
  const toSetFileQuery = useKnowledgeStore(function (state) {
    return state.toSetFileQuery
  })

  const rootTitle = rootDir ? findFileName(rootDir) || t('WORKSPACE') : t('WORKSPACE')

  const tree = useNavigationTree({
    rootDir,
    activePath,
    treeRevision,
    rootTitle,
    fileQuery,
    onOpenPath: props.onOpenPath
  })

  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null)

  async function onCreateAtRoot() {
    try {
      const root = await ensureRootDir()
      clearDirListCache(root)
      const absolute = await createMarkdownFile(root, '', `note-${Date.now()}.md`)
      toBumpTree()
      props.onOpenPath(absolute)
    } catch (error) {
      console.error(error)
      toast.error(t('CREATE_FAILED'))
    }
  }

  async function onConfirmCreate() {
    if (!createTarget) return
    const name = createTarget.name.trim()
    if (!name) return
    try {
      const root = await ensureRootDir()
      if (createTarget.kind === 'folder') {
        await createMarkdownFolder(root, createTarget.relativeDir, name)
        toBumpTree()
      } else {
        const absolute = await createMarkdownFile(root, createTarget.relativeDir, name)
        toBumpTree()
        props.onOpenPath(absolute)
      }
      setCreateTarget(null)
    } catch (error) {
      console.error(error)
      toast.error(createTarget.kind === 'folder' ? t('CREATE_FOLDER_FAILED') : t('CREATE_FAILED'))
    }
  }

  async function onConfirmDelete() {
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
        createUntitled()
      }
      setPendingDelete(null)
      tree.clearAbsolutePathCache()
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('DELETE'))
    }
  }

  async function onConfirmRename() {
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
      tree.clearAbsolutePathCache()
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
            setCreateTarget({
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
            setCreateTarget({
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

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border/50 bg-background/65 backdrop-blur-md">
      <div className="flex items-center gap-1 border-b border-border/50 px-1.5 py-1">
        <div className="relative min-w-0 flex-1">
          <Icon
            icon="lucide:search"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={fileQuery}
            placeholder={t('SEARCH')}
            className="h-7 rounded-md border-border/70 bg-muted/30 pl-7 text-xs"
            onChange={function (event) {
              toSetFileQuery(event.target.value)
            }}
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 rounded-md"
                aria-label={t('NEW_FILE')}
                onClick={function () {
                  void onCreateAtRoot()
                }}
              />
            }>
            <Icon
              icon="lucide:file-plus-2"
              className="size-3.5"
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('NEW_FILE')}</TooltipContent>
        </Tooltip>
      </div>
      <ContextMenu
        trigger="[data-tree-key]"
        findItems={findTreeMenuItems}>
        <ul
          data-tree-key={ROOT_KEY}
          data-tree-kind="directory"
          className={cn('min-h-0 flex-1 list-none overflow-x-hidden overflow-y-auto p-1 text-sm')}>
          {tree.nodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={tree.activeKey}
                expandedKeys={tree.expandedKeys}
                emptyHint={t('TREE_EMPTY')}
                onLoad={tree.loadChildren}
                onSelect={tree.onSelect}
                onExpandChange={tree.onExpandChange}
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
        title={t('RENAME')}
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
        title={createTarget?.kind === 'folder' ? t('NEW_FOLDER') : t('NEW_FILE')}
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
    </div>
  )
}

export default Navigation
