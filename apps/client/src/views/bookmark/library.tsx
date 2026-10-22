import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import { useMirrorStore } from '@/stores/mirror'
import styles from '@/views/bookmark/bookmark.module.scss'
import { BookmarkExplorer } from '@/views/bookmark/explorer'
import { fetchBookmarkTree } from '@/views/bookmark/import/db-tree'
import { mountBookmarksToTiles, type MountAs } from '@/views/bookmark/import/mount'
import type { BookmarkNode } from '@/views/bookmark/import/types'
import {
  readSortKey,
  readViewMode,
  writeSortKey,
  writeViewMode,
  type BookmarkSortKey,
  type BookmarkViewMode
} from '@/views/bookmark/view-prefs'

type BookmarkLibraryProps = {
  refreshToken: number
  onOpenImport: () => void
}

function BookmarkLibrary(props: BookmarkLibraryProps) {
  const { activeMirrorID, toReadMirror } = useMirrorStore(
    useShallow(function (state) {
      return {
        activeMirrorID: state.active.mirror?.id ?? null,
        toReadMirror: state.toReadMirror
      }
    })
  )

  const [roots, setRoots] = useState<BookmarkNode[]>([])
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [isBusy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<BookmarkViewMode>(readViewMode)
  const [sortKey, setSortKey] = useState<BookmarkSortKey>(readSortKey)

  useEffect(
    function () {
      if (!activeMirrorID) return
      let cancelled = false
      void fetchBookmarkTree(activeMirrorID)
        .then(function (tree) {
          if (!cancelled) setRoots(tree)
        })
        .catch(function (error) {
          console.error(error)
          if (!cancelled) toast.error('加载书签库失败')
        })
      return function () {
        cancelled = true
      }
    },
    [activeMirrorID, props.refreshToken]
  )

  function onUpdateViewMode(mode: BookmarkViewMode) {
    setViewMode(mode)
    writeViewMode(mode)
  }

  function onUpdateSortKey(key: BookmarkSortKey) {
    setSortKey(key)
    writeSortKey(key)
  }

  async function onMount(as: MountAs) {
    if (!activeMirrorID) return
    if (!selectedNodeIds.length) {
      toast.error('请先勾选文件夹或网址')
      return
    }
    try {
      setBusy(true)
      const result = await mountBookmarksToTiles({
        mirrorID: activeMirrorID,
        nodeIds: selectedNodeIds,
        as
      })
      await toReadMirror(activeMirrorID)
      toast.success(
        as === 'collection'
          ? `已添加为集合（${result.mounted}）`
          : `已添加为网址磁贴（${result.mounted}）`
      )
      setSelectedNodeIds([])
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : '添加到磁贴失败')
    } finally {
      setBusy(false)
    }
  }

  if (!activeMirrorID) {
    return (
      <div className={styles.body}>
        <section className={styles.chrome}>
          <p className="text-[11px] text-muted-foreground">书签库</p>
        </section>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Icon
              icon="lucide:panels-top-left"
              className="size-5"
            />
          </div>
          <p className={styles.emptyTitle}>未选择镜像</p>
          <p className={styles.emptyDesc}>请先在主窗口打开一个镜像。</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.body}>
      <section className={styles.chrome}>
        <div className={styles.toolbarGrow}>
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            书签库 · 勾选后可挂到磁贴墙
          </p>
          <Button
            size="sm"
            variant="outline"
            className={styles.primaryBtn}
            onClick={props.onOpenImport}>
            <Icon
              icon="lucide:download"
              className="size-3.5"
              aria-hidden
            />
            导入
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  disabled={isBusy || !selectedNodeIds.length}
                  className={styles.primaryBtn}
                />
              }>
              添加到磁贴
              <Icon
                icon="lucide:chevron-down"
                className="size-3.5 opacity-70"
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={function () {
                  void onMount('navigation')
                }}>
                添加为网址
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  void onMount('collection')
                }}>
                添加为集合
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {roots.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Icon
              icon="lucide:folder-open"
              className="size-5"
            />
          </div>
          <p className={styles.emptyTitle}>书签库为空</p>
          <p className={styles.emptyDesc}>从 Chrome HTML 或本机 Profile 导入后，在此浏览与挂载。</p>
          <Button
            size="sm"
            className={styles.primaryBtn}
            onClick={props.onOpenImport}>
            导入书签
          </Button>
        </div>
      ) : (
        <div className={styles.body}>
          <BookmarkExplorer
            roots={roots}
            selectedFolders={[]}
            onUpdateSelectedFolders={function () {}}
            selectionMode="node-id"
            selectedNodeIds={selectedNodeIds}
            onUpdateSelectedNodeIds={setSelectedNodeIds}
            viewMode={viewMode}
            sortKey={sortKey}
            onUpdateViewMode={onUpdateViewMode}
            onUpdateSortKey={onUpdateSortKey}
          />
        </div>
      )}
    </div>
  )
}

export { BookmarkLibrary }
