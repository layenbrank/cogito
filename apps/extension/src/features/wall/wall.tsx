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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { TileDialog } from '@/features/magnetic-tile/tile-dialog.tsx'
import { TileLibrary } from '@/features/magnetic-tile/tile-library.tsx'
import { MagneticTile as TileShell } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { Reflection } from '@/features/magnetic-tile/reflection.tsx'
import { findTileKind } from '@/features/magnetic-tile/registry.ts'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { notify } from '@/features/shell/notice-state.ts'
import { openSite } from '@/features/shell/open-site.ts'
import { canActivate } from '@/features/wall/activation.ts'
import { WallMenu } from '@/features/wall/menu.tsx'
import { bindWallSortable } from '@/features/wall/sortable.ts'
import { useCollectionStore } from '@/stores/collection'

import '@/features/wall/selection.css'
import styles from '@/features/wall/wall.module.scss'

import type { NavigateFunction } from 'react-router-dom'

interface WallProps {
  /** 为空时画镜像根上的磁贴；有值时只画这个集合里的网址 */
  collectionID: string | null
}

interface MenuState {
  x: number
  y: number
  tileID: string | null
}

/** 新建或重命名集合时的对话框状态 */
type Naming =
  | { mode: 'create' }
  | { mode: 'rename'; id: string; title: string }

function findTargets(tile: MagneticTile | null, selected: ReadonlySet<string>, tiles: readonly MagneticTile[]): MagneticTile[] {
  if (!tile) return []
  const ids = selected.has(tile.id) ? selected : new Set([tile.id])
  return tiles.filter(function (item) {
    return ids.has(item.id)
  })
}

function activateTile(tile: MagneticTile, navigate: NavigateFunction): void {
  if (tile.component === 'collection') {
    void navigate(`/collection/${tile.id}`)
    return
  }
  const kind = findTileKind(tile.component)
  if (kind.path) {
    void navigate(kind.path)
    return
  }
  // 网址磁贴：种类表里没有它（它的落点是数据里的 url）
  if (tile.component === 'navigation') {
    if (tile.url) openSite(tile.url, 'tab')
    else notify('这个磁贴还没有设置链接')
    return
  }
  notify(`${kind.label}磁贴要在桌面端打开`)
}

/**
 * 镜像上的磁贴：60px 网格、名称在磁贴下方、双击打开、右键改布局和集合、拖动排序。
 */
function Wall(props: WallProps) {
  const isReady = useMirrorStore(function (state) {
    return state.isReady
  })
  const tiles = useMirrorStore(function (state) {
    return state.tiles
  })
  const toAppendTile = useMirrorStore(function (state) {
    return state.toAppendTile
  })
  const toUpdateTile = useMirrorStore(function (state) {
    return state.toUpdateTile
  })
  const toRenameTile = useMirrorStore(function (state) {
    return state.toRenameTile
  })
  const toCreateCollection = useMirrorStore(function (state) {
    return state.toCreateCollection
  })
  const toAssignCollection = useMirrorStore(function (state) {
    return state.toAssignCollection
  })
  const toChangeLayout = useMirrorStore(function (state) {
    return state.toChangeLayout
  })
  const toRemoveTiles = useMirrorStore(function (state) {
    return state.toRemoveTiles
  })
  const toReorder = useMirrorStore(function (state) {
    return state.toReorder
  })
  const navigate = useNavigate()
  const gridRef = useRef<HTMLDivElement>(null)
  const reorderRef = useRef(toReorder)
  useEffect(function () {
    reorderRef.current = toReorder
  })

  const [selected, updateSelected] = useState<Set<string>>(function () {
    return new Set()
  })
  const [menu, updateMenu] = useState<MenuState | null>(null)
  const [editing, updateEditing] = useState<MagneticTile | null>(null)
  const [isFormOpen, updateFormOpen] = useState(false)
  const [naming, updateNaming] = useState<Naming | null>(null)
  /** 磁贴库（挑选种类）与新建表单是两步：先选种类，再填名称 */
  const [isLibraryOpen, updateLibraryOpen] = useState(false)
  const [createKind, updateCreateKind] = useState<MagneticTile.Component>('navigation')
  const [draft, updateDraft] = useState('')
  const [removing, updateRemoving] = useState<string[] | null>(null)

  const parent = props.collectionID
    ? tiles.find(function (tile) {
        return tile.id === props.collectionID
      })
    : null
  const visible = tiles.filter(function (tile) {
    if (props.collectionID) return tile.collectionID === props.collectionID
    return !tile.collectionID
  })
  const collections = tiles.filter(function (tile) {
    return tile.component === 'collection' && tile.id !== props.collectionID
  })

  const menuTile = menu?.tileID
    ? (tiles.find(function (tile) {
        return tile.id === menu.tileID
      }) ?? null)
    : null
  const targets = findTargets(menuTile, selected, tiles)

  useEffect(
    function () {
      useCollectionStore.getState().toBumpRevision()
    },
    [tiles]
  )

  useEffect(
    function () {
      const grid = gridRef.current
      if (!grid) return
      for (const node of grid.querySelectorAll<HTMLElement>('[data-id]')) {
        node.toggleAttribute('data-selected', selected.has(node.dataset.id ?? ''))
      }
    },
    [selected, visible]
  )

  useEffect(
    function () {
      const grid = gridRef.current
      if (!grid) return
      const session = bindWallSortable(grid, function (ids) {
        void reorderRef.current(ids).catch(function (error: unknown) {
          console.error('[wall] 排序失败', error)
          notify('排序没有保存')
        })
      })
      return function () {
        session.destroy()
      }
    },
    [props.collectionID]
  )

  useEffect(
    function () {
      function onKey(event: KeyboardEvent): void {
        const target = event.target
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
        if (event.key === 'Escape') {
          updateMenu(null)
          updateSelected(new Set())
        }
        if (event.key === 'Delete' && selected.size > 0) updateRemoving([...selected])
      }
      window.addEventListener('keydown', onKey)
      return function () {
        window.removeEventListener('keydown', onKey)
      }
    },
    [selected]
  )

  function openMenu(event: ReactMouseEvent<HTMLElement>): void {
    event.preventDefault()
    const host = (event.target as HTMLElement).closest('[data-id]')
    const tileID = host?.getAttribute('data-id') ?? null
    if (tileID && !selected.has(tileID)) updateSelected(new Set([tileID]))
    updateMenu({ x: event.clientX, y: event.clientY, tileID })
  }

function selectTile(tileID: string, event: ReactMouseEvent<HTMLElement>): void {
  updateMenu(null)
  updateSelected(function (current) {
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current)
        if (next.has(tileID)) next.delete(tileID)
        else next.add(tileID)
        return next
      }
      return new Set([tileID])
    })
  }

  function fail(error: unknown, message: string): void {
    console.error('[wall]', error)
    notify(message)
  }

  const missingCollection = Boolean(props.collectionID) && isReady && !parent

  return (
    <main
      className={clsx('relative h-full')}
      onClick={function (event) {
        if ((event.target as HTMLElement).closest('[data-id]')) return
        updateSelected(new Set())
        updateMenu(null)
      }}
      onContextMenu={openMenu}>
      {props.collectionID ? (
        <div className={clsx('absolute top-4 left-4 z-20 flex items-center gap-3')}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={function () {
              void navigate('/overview')
            }}>
            返回镜像
          </Button>
          <span
            className={clsx('text-sm text-foreground')}
            style={{ textShadow: '0 1px 2px color-mix(in oklab, black 55%, transparent)' }}>
            {parent?.title || '集合'}
          </span>
        </div>
      ) : null}

      <div
        ref={gridRef}
        className={clsx(styles.grid, 'overscroll-y-contain', props.collectionID && 'pt-16')}
        onClickCapture={function (event) {
          const id = (event.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id')
          if (!id) return
          selectTile(id, event)
        }}>
        {visible.map(function (tile, index) {
          const Face = Reflection[tile.component]
          if (!Face) return null
          return (
            <TileShell.Enter
              key={tile.id}
              index={index}>
              <TileShell.Suspense
                id={tile.id}
                size={tile.size}
                shape={tile.shape}
                direction={tile.direction}>
                <Face {...tile} />
              </TileShell.Suspense>
            </TileShell.Enter>
          )
        })}
      </div>

      {isReady && visible.length === 0 ? (
        <p
          className={clsx(
            'pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-foreground'
          )}
          style={{ textShadow: '0 1px 2px color-mix(in oklab, black 55%, transparent)' }}>
          {missingCollection
            ? '这个集合已经不在了。'
            : '右键空白处可以添加网站或新建集合。双击磁贴打开，拖动可以排序。'}
        </p>
      ) : null}

      {menu ? (
        <WallMenu
          x={menu.x}
          y={menu.y}
          tile={menuTile}
          targets={targets}
          collections={collections}
          canOpen={menuTile ? canActivate(menuTile) : false}
          onClose={function () {
            updateMenu(null)
          }}
          onOpen={function () {
            if (menuTile) activateTile(menuTile, navigate)
            updateMenu(null)
          }}
          onEdit={function () {
            if (!menuTile) return
            if (menuTile.component === 'collection') {
              updateDraft(menuTile.title)
              updateNaming({ mode: 'rename', id: menuTile.id, title: menuTile.title })
            } else {
              updateEditing(menuTile)
              updateFormOpen(true)
            }
            updateMenu(null)
          }}
          onLayout={function (layout) {
            const ids = targets.map(function (tile) {
              return tile.id
            })
            void toChangeLayout(ids, layout).catch(function (error: unknown) {
              fail(error, '布局没有保存')
            })
          }}
          onAssign={function (collectionID) {
            const ids = targets.map(function (tile) {
              return tile.id
            })
            void toAssignCollection(ids, collectionID)
              .then(function () {
                notify(collectionID ? '已加入集合' : '已移出集合')
              })
              .catch(function (error: unknown) {
                fail(error, '集合没有更新')
              })
            updateMenu(null)
            updateSelected(new Set())
          }}
          onCreateCollection={function () {
            updateDraft('')
            updateNaming({ mode: 'create' })
            updateMenu(null)
          }}
          onRemove={function () {
            updateRemoving(
              targets.map(function (tile) {
                return tile.id
              })
            )
            updateMenu(null)
          }}
          onAddTile={function () {
            updateEditing(null)
            updateLibraryOpen(true)
            updateMenu(null)
          }}
          onOpenBookmarks={function () {
            void navigate('/bookmarks')
          }}
          onOpenSettings={function () {
            void navigate('/settings')
          }}
        />
      ) : null}

      {isLibraryOpen ? (
        <TileLibrary
          onOpenChange={updateLibraryOpen}
          onPick={function (component) {
            updateCreateKind(component)
            updateLibraryOpen(false)
            updateFormOpen(true)
          }}
        />
      ) : null}

      {isFormOpen ? (
        <TileDialog
          key={editing?.id ?? 'create'}
          tile={editing}
          component={createKind}
          onOpenChange={updateFormOpen}
          onSubmit={async function (input) {
            if (editing) {
              await toUpdateTile(editing.id, input)
              notify('已保存')
              return
            }
            await toAppendTile(input)
            notify('已加到镜像')
          }}
        />
      ) : null}

      {naming ? (
        <Dialog
          open
          onOpenChange={function (open) {
            if (!open) updateNaming(null)
          }}>
          <DialogContent className={clsx('sm:max-w-sm')}>
            <DialogHeader>
              <DialogTitle>{naming.mode === 'rename' ? '重命名集合' : '新建集合'}</DialogTitle>
            </DialogHeader>
            <div className={clsx('grid gap-2')}>
              <Label htmlFor="collection-title">名称</Label>
              <Input
                id="collection-title"
                value={draft}
                placeholder="工作"
                onChange={function (event) {
                  updateDraft(event.target.value)
                }}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={function () {
                  const title = draft.trim()
                  if (!title) {
                    notify('请填写名称')
                    return
                  }
                  const task =
                    naming.mode === 'rename'
                      ? toRenameTile(naming.id, title)
                      : toCreateCollection(title)
                  void task
                    .then(function () {
                      notify(naming.mode === 'rename' ? '已重命名' : '已新建集合')
                      updateNaming(null)
                    })
                    .catch(function (error: unknown) {
                      fail(error, '集合没有保存')
                    })
                }}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog
        open={Boolean(removing?.length)}
        onOpenChange={function (open) {
          if (!open) updateRemoving(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing && removing.length > 1 ? `删除 ${removing.length} 个磁贴？` : '删除这个磁贴？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              磁贴会从镜像里拿掉。删掉集合时，里面的网站会回到镜像。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                if (!removing?.length) return
                void toRemoveTiles(removing)
                  .then(function () {
                    updateSelected(new Set())
                  })
                  .catch(function (error: unknown) {
                    fail(error, '没有删除')
                  })
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export { Wall }
