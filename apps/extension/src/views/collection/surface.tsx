import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { useCallback, type Dispatch, type SetStateAction } from 'react'

import { useMirrorStore } from '@/features/mirror/store.ts'
import { notify } from '@/features/shell/notice-state.ts'
import { useCollectionStore } from '@/stores/collection.ts'
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
  isAddOpen: boolean
  onUpdateAddOpen: (open: boolean) => void
}

function CollectionSurface(props: CollectionSurfaceProps) {
  const currentId = props.stack[props.stack.length - 1] ?? props.id
  const toBumpRevision = useCollectionStore(function (state) {
    return state.toBumpRevision
  })
  const toAssignCollection = useMirrorStore(function (state) {
    return state.toAssignCollection
  })
  const onUpdateMagneticTiles = props.onUpdateMagneticTiles

  const handleRemove = useCallback(
    async function (tileId: string) {
      try {
        await toAssignCollection([tileId], null)
        onUpdateMagneticTiles(function (prev) {
          return prev.filter(function (tile) {
            return tile.id !== tileId
          })
        })
        toBumpRevision()
      } catch (cause) {
        console.warn('[collection] 移出失败:', cause)
        notify('移出集合失败')
      }
    },
    [toAssignCollection, toBumpRevision, onUpdateMagneticTiles]
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

  const canGoBack = props.stack.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/80">
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
              <Icon icon="lucide:arrow-left" aria-hidden />
            </Button>
          ) : null}
          <div className="min-w-0">
            <Tooltip>
              <TooltipTrigger
                render={<h2 className="max-w-full truncate text-lg font-semibold tracking-tight text-foreground" />}>
                {props.title}
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[min(24rem,80vw)] wrap-break-word">
                {props.title}
              </TooltipContent>
            </Tooltip>
            <p className="truncate text-xs text-muted-foreground">
              {props.magneticTiles.length ? `${props.magneticTiles.length} 个项目` : '空集合'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="添加已有网址"
          title="添加已有网址"
          className="size-9 rounded-lg text-muted-foreground"
          onClick={function () {
            props.onUpdateAddOpen(true)
          }}>
          <Icon icon="lucide:plus" aria-hidden />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-6 pb-8">
        {props.magneticTiles.length ? (
          <Controller magneticTiles={props.magneticTiles} onPick={handlePick} onRemove={handleRemove} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
              <Icon icon="lucide:folder-open" className="size-7" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">还没有内容</p>
              <p className="text-sm text-muted-foreground">从镜像上未归组的网址磁贴里挑选</p>
            </div>
            <Button
              onClick={function () {
                props.onUpdateAddOpen(true)
              }}>
              <Icon icon="lucide:plus" aria-hidden />
              添加网址
            </Button>
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
