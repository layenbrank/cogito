/**
 * Markdown 工作区 · 左侧文件导航：搜索/新建工具条 + 文件树 + 重命名/删除确认。
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
} from '@i-thinking/design/components/alert-dialog'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useMarkdownStore } from '@/stores/markdown'
import {
  clearDirListCache,
  createMarkdownFile,
  removeMarkdownPath,
  renameMarkdownPath
} from '@/views/markdown/lib/fs.ts'
import { findFileName } from '@/views/markdown/lib/path.ts'
import { ensureRootDir } from '@/views/markdown/lib/session.ts'
import { t } from '@/views/markdown/locale.ts'
import { FileTreeItem } from '@/views/workspace/overlay/file-tree-item.tsx'
import { useNavigationTree } from '@/views/markdown/workspace/overlay/use-navigation-tree.ts'

interface NavigationProps {
  onOpenPath: (path: string) => void
}

/** 删除确认：只展示待删路径 */
function DeleteConfirmDialog(props: {
  path: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={props.path !== null}
      onOpenChange={function (open) {
        if (!open) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('DELETE_CONFIRM')}</AlertDialogTitle>
          <AlertDialogDescription>{props.path}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{t('DELETE')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 重命名：单行输入 */
function RenameDialog(props: {
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
          <AlertDialogTitle>{t('RENAME')}</AlertDialogTitle>
        </AlertDialogHeader>
        <Input
          value={props.name ?? ''}
          className="h-8"
          onChange={function (event) {
            props.onChange(event.target.value)
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{t('RENAME')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
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
  const toSetFileQuery = useMarkdownStore(function (state) {
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

  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{
    absolute: string
    name: string
  } | null>(null)

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
      tree.clearAbsolutePathCache()
      setRenameTarget(null)
      toBumpTree()
    } catch (error) {
      console.error(error)
      toast.error(t('RENAME'))
    }
  }

  const treeMenuItems = useMemo(
    function (): MenuItem[] {
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
    },
    [activePath]
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
          className={cn('min-h-0 flex-1 list-none overflow-x-hidden overflow-y-auto p-1 text-sm')}>
          {tree.nodes.map(function (node) {
            return (
              <FileTreeItem
                key={node.key}
                node={node}
                activeKey={tree.activeKey}
                expandedKeys={tree.expandedKeys}
                onLoad={tree.loadChildren}
                onSelect={tree.onSelect}
                onExpandChange={tree.onExpandChange}
              />
            )
          })}
        </ul>
      </ContextMenu>

      <DeleteConfirmDialog
        path={pendingDelete}
        onCancel={function () {
          setPendingDelete(null)
        }}
        onConfirm={function () {
          void onConfirmDelete()
        }}
      />

      <RenameDialog
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
    </div>
  )
}

export default Navigation
