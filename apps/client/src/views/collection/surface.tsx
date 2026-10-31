import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'

import { useCollectionStore } from '@/stores/collection'
import { useMirrorStore } from '@/stores/mirror'
import { AddSheet } from '@/views/collection/add-sheet.tsx'
import { Controller } from '@/views/collection/controller.tsx'

interface CollectionSurfaceProps {
  id: string
  stack: string[]
  onUpdateStack: Dispatch<SetStateAction<string[]>>
  title: string
  magneticTiles: MagneticTile[]
  onUpdateMagneticTiles: Dispatch<SetStateAction<MagneticTile[]>>
  onReloadMembers: () => void
  /** 与 URL `?add=1` 同步 */
  isAddOpen: boolean
  onUpdateAddOpen: (open: boolean) => void
}

function CollectionSurface(props: CollectionSurfaceProps) {
  const currentId = props.stack[props.stack.length - 1] ?? props.id
  const toUpdateMagneticTile = useMirrorStore(function (state) {
    return state.toUpdateMagneticTile
  })
  const toBumpRevision = useCollectionStore(function (state) {
    return state.toBumpRevision
  })

  const onUpdateMagneticTiles = props.onUpdateMagneticTiles
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
      } catch (cause) {
        console.warn('[collection] 移出失败:', cause)
        toast.error('移出文件夹失败')
      }
    },
    [toUpdateMagneticTile, toBumpRevision, onUpdateMagneticTiles]
  )

  function handlePick(tileId: string) {
    const tile = props.magneticTiles.find(function (item) {
      return item.id === tileId
    })
    if (!tile) return
    if (tile.component === 'collection') {
      props.onUpdateStack(function (prev) {
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

  const canGoBack = props.stack.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-6 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          {canGoBack ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="返回上级文件夹"
              className="size-8 shrink-0"
              onClick={function () {
                props.onUpdateStack(function (prev) {
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
            <h2 className="text-foreground truncate text-lg font-semibold tracking-tight">
              {props.title}
            </h2>
            <p className="text-muted-foreground truncate text-xs">
              {props.magneticTiles.length
                ? `${props.magneticTiles.length} 个项目`
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
                  className="text-muted-foreground size-10 rounded-md"
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
        {props.magneticTiles.length ? (
          <Controller
            magneticTiles={props.magneticTiles}
            onPick={handlePick}
            onRemove={handleRemove}
            density="comfortable"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="bg-muted/60 text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
              <Icon
                icon="lucide:folder-open"
                className="size-7"
                aria-hidden
              />
            </div>
            <div className="space-y-1">
              <p className="text-foreground text-sm font-medium">还没有内容</p>
              <p className="text-muted-foreground text-sm">
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
          props.onReloadMembers()
          toBumpRevision()
        }}
      />
    </div>
  )
}

export { CollectionSurface }
export type { CollectionSurfaceProps }
