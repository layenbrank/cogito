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
import { useMirrorStore } from '@/features/mirror/store.ts'
import { notify } from '@/features/shell/notice-state.ts'
import { openSite } from '@/features/shell/open-site.ts'
import { canActivate } from '@/features/wall/activation.ts'
import { WallMenu } from '@/features/wall/menu.tsx'
import { TILE_GAP, TILE_UNIT } from '@/features/wall/metrics.ts'
import { bindWallSortable } from '@/features/wall/sortable.ts'
import { WallTile } from '@/features/wall/tile-shell.tsx'

import type { NavigateFunction } from 'react-router-dom'

interface WallProps {
  /** 为空时画墙面根；有值时只画这个集合里的网址 */
  collectionID: string | null
}

interface MenuState {
  x: number
  y: number
  tileID: string | null
}

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
  if (tile.component === 'bookmark') {
    void navigate('/bookmarks')
    return
  }
  if (tile.component === 'settings') {
    void navigate('/settings')
    return
  }
  if (tile.url) {
    openSite(tile.url, 'tab')
    return
  }
  notify('这个磁贴要在桌面端打开')
}

/**
 * 桌面式墙面：60px 网格、名称在磁贴下方、双击打开、右键改布局和集合、拖动排序。
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

  const [now, updateNow] = useState(function () {
    return new Date()
  })
  const [selected, updateSelected] = useState<Set<string>>(function () {
    return new Set()
  })
  const [menu, updateMenu] = useState<MenuState | null>(null)
  const [editing, updateEditing] = useState<MagneticTile | null>(null)
  const [isFormOpen, updateFormOpen] = useState(false)
  const [naming, updateNaming] = useState<Naming | null>(null)
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
  const counts = new Map<string, number>()
  for (const tile of tiles) {
    if (!tile.collectionID) continue
    counts.set(tile.collectionID, (counts.get(tile.collectionID) ?? 0) + 1)
  }

  const menuTile = menu?.tileID
    ? (tiles.find(function (tile) {
        return tile.id === menu.tileID
      }) ?? null)
    : null
  const targets = findTargets(menuTile, selected, tiles)

  useEffect(function () {
    const timer = window.setInterval(function () {
      updateNow(new Date())
    }, 1000)
    return function () {
      window.clearInterval(timer)
    }
  }, [])

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
    event.stopPropagation()
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
            返回墙面
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
        className={clsx(
          'grid h-full content-start justify-center overflow-y-auto overscroll-y-contain px-5 pb-16',
          props.collectionID ? 'pt-16' : 'pt-8'
        )}
        style={{
          gridTemplateColumns: `repeat(auto-fit, ${TILE_UNIT}px)`,
          gridAutoRows: `${TILE_UNIT}px`,
          gridAutoFlow: 'row dense',
          columnGap: TILE_GAP,
          rowGap: TILE_GAP
        }}>
        {visible.map(function (tile) {
          return (
            <WallTile
              key={tile.id}
              tile={tile}
              now={now}
              isSelected={selected.has(tile.id)}
              memberCount={counts.get(tile.id) ?? 0}
              onSelect={function (event) {
                selectTile(tile.id, event)
              }}
              onActivate={function () {
                activateTile(tile, navigate)
              }}
            />
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
          onAddSite={function () {
            updateEditing(null)
            updateFormOpen(true)
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

      {isFormOpen ? (
        <TileDialog
          key={editing?.id ?? 'create'}
          tile={editing}
          onOpenChange={updateFormOpen}
          onSubmit={async function (input) {
            if (editing) {
              await toUpdateTile(editing.id, input)
              notify('已保存')
              return
            }
            await toAppendTile(input)
            notify('已添加到墙上')
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
              磁贴会从墙上拿掉。删掉集合时，里面的网站会回到墙面。
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
