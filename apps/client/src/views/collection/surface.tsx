import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import { useCollectionStore } from '@/stores/collection'
import { useMirrorStore } from '@/stores/mirror'
import { AddSheet } from '@/views/collection/add-sheet.tsx'
import { Controller } from '@/views/collection/controller.tsx'

interface CollectionSurfaceProps {
  id: string
  /** 与 URL `?add=1` 同步 */
  isAddOpen: boolean
  onUpdateAddOpen: (open: boolean) => void
  /** 同步顶栏标题 */
  onTitleChange?: (title: string) => void
}

function CollectionSurface(props: CollectionSurfaceProps) {
  const [stack, setStack] = useState<string[]>([props.id])
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])
  const [title, onUpdateTitle] = useState('文件夹')
  const toUpdateMagneticTile = useMirrorStore(function (state) {
    return state.toUpdateMagneticTile
  })
  const toBumpRevision = useCollectionStore(function (state) {
    return state.toBumpRevision
  })

  const currentId = stack[stack.length - 1] ?? props.id
  const onTitleChange = props.onTitleChange
  const [membersToken, bumpMembersToken] = useState(0)

  useEffect(
    function () {
      let cancelled = false

      async function toFetchMembers() {
        try {
          const [members, hosts] = await Promise.all([
            invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
              params: { collectionID: currentId }
            }),
            invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
              params: { id: currentId }
            })
          ])
          if (cancelled) return
          onUpdateMagneticTiles(
            members.toSorted(function (a, b) {
              return a.index - b.index
            })
          )
          const [host] = hosts
          const nextTitle = host?.title?.trim() || '文件夹'
          onUpdateTitle(nextTitle)
          onTitleChange?.(nextTitle)
        } catch {
          if (cancelled) return
          onUpdateMagneticTiles([])
          toast.error('文件夹内容加载失败')
        }
      }

      void toFetchMembers()
      return function () {
        cancelled = true
      }
    },
    [currentId, membersToken, onTitleChange]
  )

  const handleRemove = useCallback(
    async function (tileId: string) {
      try {
        await toUpdateMagneticTile([
          {
            key: tileId,
            change: { collectionID: null }
          }
        ])
        onUpdateMagneticTiles(function (prev) {
          return prev.filter(function (tile) {
            return tile.id !== tileId
          })
        })
        toBumpRevision()
      } catch {
        toast.error('移出文件夹失败')
      }
    },
    [toUpdateMagneticTile, toBumpRevision]
  )

  function handlePick(tileId: string) {
    const tile = magneticTiles.find(function (item) {
      return item.id === tileId
    })
    if (!tile) return
    if (tile.component === 'collection') {
      setStack(function (prev) {
        return [...prev, tileId]
      })
    }
  }

  async function openBookmarkLibrary() {
    try {
      const { admitSession } = await import('@/features/magnetic-tile/session')
      admitSession({
        component: 'bookmark',
        id: 'bookmark',
        url: '',
        path: '/bookmark'
      })
      const { router } = await import('@/routers')
      await router.navigate('/bookmark')
    } catch (error) {
      console.error(error)
      toast.error('无法打开书签库')
    }
  }

  const canGoBack = stack.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-6 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          {canGoBack ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="返回上级文件夹"
              className="size-8 shrink-0"
              onClick={function () {
                setStack(function (prev) {
                  if (prev.length <= 1) return prev
                  return prev.slice(0, -1)
                })
              }}>
              <Icon
                icon="lucide:arrow-left"
                aria-hidden
              />
            </Button>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {magneticTiles.length
                ? `${magneticTiles.length} 个项目`
                : '空集合'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={function () {
              void openBookmarkLibrary()
            }}>
            打开书签库
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="新增网址"
                  aria-pressed={props.isAddOpen}
                  className="size-10 rounded-md text-muted-foreground"
                  onClick={function () {
                    props.onUpdateAddOpen(!props.isAddOpen)
                  }}
                />
              }>
              <Icon
                icon="lucide:plus"
                aria-hidden
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">新增网址</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-8">
        {magneticTiles.length ? (
          <Controller
            magneticTiles={magneticTiles}
            onPick={handlePick}
            onRemove={handleRemove}
            density="comfortable"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
              <Icon
                icon="lucide:folder-open"
                className="size-7"
                aria-hidden
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">还没有内容</p>
              <p className="text-sm text-muted-foreground">
                从主镜未归组的网址磁贴里挑选，或去书签库批量挂载
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                onClick={function () {
                  props.onUpdateAddOpen(true)
                }}>
                <Icon
                  icon="lucide:plus"
                  aria-hidden
                />
                新增网址
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={function () {
                  void openBookmarkLibrary()
                }}>
                打开书签库
              </Button>
            </div>
          </div>
        )}
      </div>

      <AddSheet
        id={currentId}
        open={props.isAddOpen}
        onUpdateOpen={props.onUpdateAddOpen}
        onJoined={function () {
          bumpMembersToken(function (token) {
            return token + 1
          })
          toBumpRevision()
        }}
      />
    </div>
  )
}

export { CollectionSurface }
export type { CollectionSurfaceProps }
