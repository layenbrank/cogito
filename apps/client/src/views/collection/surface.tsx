import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'

import { useCollectionStore } from '@/stores/collection'
import { leaveCollection } from '@/features/magnetic-tile/collection-actions.ts'
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
  const toBumpRevision = useCollectionStore(function (state) {
    return state.toBumpRevision
  })

  const onUpdateMagneticTiles = props.onUpdateMagneticTiles
  const handleRemove = useCallback(
    async function (tileId: string) {
      try {
        // 移出集合的写入语义统一在 collection-actions 里（含 `collectionID: null` 的置空写法）
        await leaveCollection([tileId])
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
    [toBumpRevision, onUpdateMagneticTiles]
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
            {/* 长标题会被 truncate：tooltip 锡在标题元素上（bottom / 开头对齐），不再跟鼠标跑 */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <h2 className="text-foreground max-w-full truncate text-lg font-semibold tracking-tight" />
                }>
                {props.title}
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="max-w-[min(24rem,80vw)] wrap-break-word">
                {props.title}
              </TooltipContent>
            </Tooltip>
            <p className="text-muted-foreground truncate text-xs">
              {props.magneticTiles.length
                ? `${props.magneticTiles.length} 个项目`
                : '空集合'}
            </p>
          </div>
        </div>
        {/*
         * 这里只留一个动作：添加已有网址。
         * 以前是个下拉（新建子集合 / 添加已有网址），而集合**不支持嵌套**，
         * 多一步选择只是让用户多猜一次；分开一个 + 比下拉快得多。
         */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="添加已有网址"
            title="添加已有网址"
            className="text-muted-foreground size-9 rounded-lg"
            onClick={function () {
              props.onUpdateAddOpen(true)
            }}>
            <Icon
              icon="lucide:plus"
              aria-hidden
            />
          </Button>
        </div>
      </header>

      {/* scrollbar-gutter：抽屉开关不改变内容宽度，网格不会重排（图标不会「跳一下」） */}
      <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-x-hidden overflow-y-auto px-6 pb-8">
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
                从主镜未归组的网址磁贴里挑选
              </p>
            </div>
            <Button
              size="default"
              onClick={function () {
                props.onUpdateAddOpen(true)
              }}>
              <Icon
                icon="lucide:plus"
                aria-hidden
              />
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
export type { CollectionSurfaceProps }
