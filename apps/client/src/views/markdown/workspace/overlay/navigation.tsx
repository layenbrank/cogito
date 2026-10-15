import { Icon } from '@iconify/react/offline'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { resolve } from '@tauri-apps/api/path'
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useMarkdownStore } from '@/stores/markdown'
import {
  TREE_PAGE_SIZE,
  clearDirListCache,
  createMarkdownFile,
  listMarkdownEntries,
  removeMarkdownPath,
  renameMarkdownPath,
  type TreeEntry
} from '@/views/markdown/lib/fs.ts'
import { findFileName, normalizeSeparators } from '@/views/markdown/lib/path.ts'
import { ensureRootDir } from '@/views/markdown/lib/session.ts'
import { t } from '@/views/markdown/locale.ts'
import {
  FileTreeItem,
  type FileTreeNode
} from '@/views/workspace/overlay/file-tree-item.tsx'
import {
  appendFileTreeChildren,
  filterFileTreeNodes,
  findFileTreeNode,
  patchFileTreeNode,
  scheduleChunkedChildren,
  updateFileTreeNodes
} from '@/views/workspace/overlay/file-tree.ts'

const ROOT_KEY = 'ROOT'

interface NavigationProps {
  onOpenPath(path: string): void
}

function findLoadMoreKey(parentKey: string) {
  return `${parentKey}::__load_more`
}

function mapEntriesToNodes(
  entries: TreeEntry[],
  parentKey: string,
  hasMore: boolean,
  nextOffset: number
): FileTreeNode[] {
  const nodes: FileTreeNode[] = entries.map(function (entry) {
    return {
      title: entry.name,
      key: entry.path,
      isLeaf: !entry.isDirectory,
      isDirectory: entry.isDirectory,
      isLoaded: false
    }
  })
  if (hasMore) {
    nodes.push({
      title: t('LOAD_MORE'),
      key: findLoadMoreKey(parentKey),
      isLeaf: true,
      isLoadMore: true,
      nextOffset
    })
  }
  return nodes
}

function findRelativeKeyFromAbsolute(root: string, absolute: string): string | null {
  const rootNorm = normalizeSeparators(root).replace(/\/+$/, '')
  const absNorm = normalizeSeparators(absolute).replace(/\/+$/, '')
  const rootCmp = rootNorm.toLowerCase()
  const absCmp = absNorm.toLowerCase()
  if (absCmp === rootCmp) return ROOT_KEY
  if (!absCmp.startsWith(`${rootCmp}/`)) return null
  return absNorm.slice(rootNorm.length + 1)
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
  const fileQuery = useMarkdownStore(function (state) {
    return state.fileQuery
  })

  const rootTitle = rootDir ? findFileName(rootDir) || t('WORKSPACE') : t('WORKSPACE')

  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([
    {
      title: rootTitle,
      key: ROOT_KEY,
      isDirectory: true,
      isLoaded: false
    }
  ])
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(function () {
    return new Set([ROOT_KEY])
  })
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{
    absolute: string
    name: string
  } | null>(null)

  const treeNodesRef = useRef(treeNodes)
  treeNodesRef.current = treeNodes

  const loadGenRef = useRef(0)
  const cancelChunkRef = useRef<(() => void) | null>(null)
  const absolutePathCacheRef = useRef(new Map<string, string>())

  const activeKey = useMemo(
    function () {
      if (!activePath || !rootDir) return null
      return findRelativeKeyFromAbsolute(rootDir, activePath)
    },
    [activePath, rootDir]
  )

  // 搜索只做客户端过滤，不再 force readDir
  const visibleNodes = useMemo(
    function () {
      const query = fileQuery.trim()
      if (!query) return treeNodes
      return filterFileTreeNodes(treeNodes, query)
    },
    [treeNodes, fileQuery]
  )

  function cancelPendingChunk() {
    cancelChunkRef.current?.()
    cancelChunkRef.current = null
  }

  const loadChildren = useCallback(async function (
    node: FileTreeNode,
    options: { force?: boolean; append?: boolean } = {}
  ) {
    const current = findFileTreeNode(treeNodesRef.current, node.key) ?? node
    if (current.isLoading) return
    if (current.isLoaded && !options.force && !options.append) return

    const gen = ++loadGenRef.current
    cancelPendingChunk()

    setTreeNodes(function (origin) {
      return patchFileTreeNode(origin, node.key, { isLoading: true })
    })

    try {
      const root = await ensureRootDir()
      if (gen !== loadGenRef.current) return

      const relative = node.key === ROOT_KEY ? '' : node.key
      const offset = options.append
        ? (current.nextOffset ??
          current.children?.filter(function (child) {
            return !child.isLoadMore
          }).length ??
          0)
        : 0

      const result = await listMarkdownEntries(root, relative, {
        offset,
        limit: TREE_PAGE_SIZE
      })
      if (gen !== loadGenRef.current) return

      const nextOffset = offset + result.entries.length
      const mapped = mapEntriesToNodes(
        result.entries,
        node.key,
        result.hasMore,
        nextOffset
      )

      if (options.append) {
        setTreeNodes(function (origin) {
          return appendFileTreeChildren(origin, node.key, mapped, {
            hasMore: result.hasMore,
            nextOffset
          })
        })
        return
      }

      // 首批立即上屏，其余分帧追加；完成后再挂 Load more 哨兵
      const contentNodes = mapped.filter(function (item) {
        return !item.isLoadMore
      })
      const sentinel = mapped.find(function (item) {
        return item.isLoadMore
      })
      let painted = 0

      cancelChunkRef.current = scheduleChunkedChildren(
        function (chunk, isFirst, isDone) {
          if (gen !== loadGenRef.current) return
          painted += chunk.length
          const finalExtra =
            isDone && sentinel ? [...chunk, sentinel] : chunk
          setTreeNodes(function (origin) {
            if (isFirst) {
              return updateFileTreeNodes(origin, node.key, finalExtra, {
                hasMore: isDone ? result.hasMore : false,
                nextOffset: isDone ? nextOffset : painted
              })
            }
            return appendFileTreeChildren(origin, node.key, finalExtra, {
              hasMore: isDone ? result.hasMore : false,
              nextOffset: isDone ? nextOffset : painted
            })
          })
        },
        contentNodes
      )
    } catch (error) {
      if (gen !== loadGenRef.current) return
      console.error('[markdown] tree load failed', error)
      setTreeNodes(function (origin) {
        return patchFileTreeNode(origin, node.key, {
          isLoading: false,
          isLoaded: false
        })
      })
      toast.error(t('OPEN_FAILED'))
    }
  }, [])

  // 工作区根 / revision：清缓存并 reload ROOT（分帧灌入）
  useEffect(
    function () {
      clearDirListCache()
      absolutePathCacheRef.current.clear()
      cancelPendingChunk()
      loadGenRef.current += 1

      void ensureRootDir().then(function () {
        setTreeNodes([
          {
            title: rootTitle,
            key: ROOT_KEY,
            isDirectory: true,
            isLoaded: false,
            isLoading: false
          }
        ])
        setExpandedKeys(function (prev) {
          const next = new Set(prev)
          next.add(ROOT_KEY)
          return next
        })
        void loadChildren(
          { title: rootTitle, key: ROOT_KEY, isDirectory: true },
          { force: true }
        )
      })

      return function () {
        cancelPendingChunk()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootDir, treeRevision, rootTitle, loadChildren]
  )

  const onExpandChange = useCallback(function (key: string, open: boolean) {
    setExpandedKeys(function (prev) {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const onOpenPathRef = useRef(props.onOpenPath)
  onOpenPathRef.current = props.onOpenPath

  const onSelect = useCallback(
    function (node: FileTreeNode) {
      if (node.key === ROOT_KEY) return

      if (node.isLoadMore) {
        const parentKey = node.key.replace(/::__load_more$/, '')
        const parent = findFileTreeNode(treeNodesRef.current, parentKey)
        if (parent) void loadChildren(parent, { append: true })
        return
      }

      if (node.isDirectory || !node.isLeaf) return

      void (async function () {
        const cached = absolutePathCacheRef.current.get(node.key)
        if (cached) {
          onOpenPathRef.current(cached)
          return
        }
        const root = await ensureRootDir()
        const segments = normalizeSeparators(node.key)
          .split('/')
          .filter(Boolean)
        const absolute = await resolve(root, ...segments)
        absolutePathCacheRef.current.set(node.key, absolute)
        onOpenPathRef.current(absolute)
      })()
    },
    [loadChildren]
  )

  async function onCreate() {
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

  async function onConfirmDelete() {
    if (!pendingDelete || !rootDir) return
    try {
      await removeMarkdownPath(pendingDelete, rootDir)
      clearDirListCache()
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
      clearDirListCache()
      absolutePathCacheRef.current.clear()
      setRenameTarget(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('RENAME'))
    }
  }

  const toSetFileQuery = useMarkdownStore(function (state) {
    return state.toSetFileQuery
  })

  const treeMenuItems = useMemo(function (): MenuItem[] {
    return [
      {
        key: 'rename',
        label: t('RENAME'),
        disabled: !activePath,
        icon: (
          <Icon
            icon="lucide:pencil"
            className="size-3.5"
          />
        ),
        onSelect() {
          if (!activePath) return
          const name = activePath.split(/[/\\]/).pop() ?? 'note.md'
          setRenameTarget({ absolute: activePath, name })
        }
      },
      {
        key: 'delete',
        label: t('DELETE'),
        danger: true,
        disabled: !activePath,
        icon: (
          <Icon
            icon="lucide:trash-2"
            className="size-3.5"
          />
        ),
        onSelect() {
          if (!activePath) return
          setPendingDelete(activePath)
        }
      }
    ]
  }, [activePath])

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
                  void onCreate()
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
      <ContextMenu items={treeMenuItems}>
        <ul
          className={cn(
            'min-h-0 flex-1 list-none overflow-x-hidden overflow-y-auto p-1 text-sm'
          )}>
          {visibleNodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={activeKey}
                expandedKeys={expandedKeys}
                onLoad={loadChildren}
                onSelect={onSelect}
                onExpandChange={onExpandChange}
              />
            )
          })}
        </ul>
      </ContextMenu>

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
