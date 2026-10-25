/**
 * 集合页「新增网址」：页面级 Sheet（不嵌 Dialog），点遮罩 / Esc / 关闭钮均可关掉。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle
} from '@cogito/design/components/sheet'
import { invoke } from '@tauri-apps/api/core'
import Fuse from 'fuse.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import { BELOW_CAPTION } from '@/features/browser-bar/metrics'
import { useMirrorStore } from '@/stores/mirror'
import { Controller } from '@/views/collection/controller.tsx'

interface AddSheetProps {
  id: string
  open: boolean
  onUpdateOpen: (value: boolean) => void
  /** 加入成功后刷新面板成员 */
  onJoined?: () => void
}

const FUSE_OPTIONS = {
  keys: ['title', 'url'] as const,
  threshold: 0.4
}

function AddSheet(props: AddSheetProps) {
  const [keyword, onUpdateKeyword] = useState('')
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])
  const toUpdateMagneticTile = useMirrorStore(function (state) {
    return state.toUpdateMagneticTile
  })

  useEffect(
    function () {
      if (!props.open) return

      let cancelled = false

      async function toLoad() {
        try {
          const result = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
            params: {}
          })
          if (cancelled) return

          const candidates = (result ?? []).filter(function (tile) {
            return !tile.collectionID && tile.component === 'navigation'
          })
          onUpdateMagneticTiles(candidates)
        } catch {
          if (cancelled) return
          onUpdateMagneticTiles([])
          toast.error('磁贴数据加载失败')
        }
      }

      void toLoad()

      return function () {
        cancelled = true
      }
    },
    [props.open]
  )

  useEffect(
    function () {
      if (props.open) return
      onUpdateKeyword('')
    },
    [props.open]
  )

  const fuse = useMemo(
    function () {
      return new Fuse(magneticTiles, { ...FUSE_OPTIONS, keys: [...FUSE_OPTIONS.keys] })
    },
    [magneticTiles]
  )

  const queriedMagneticTiles = useMemo(
    function () {
      const trimmed = keyword.trim()
      if (!trimmed.length) return magneticTiles
      return fuse.search(trimmed).map(function (hit) {
        return hit.item
      })
    },
    [fuse, magneticTiles, keyword]
  )

  const { id: collectionId, onJoined } = props

  const handlePick = useCallback(
    async function (tileId: string) {
      try {
        await toUpdateMagneticTile([
          {
            key: tileId,
            change: { collectionID: collectionId }
          }
        ])
        onUpdateMagneticTiles(function (prev) {
          return prev.filter(function (tile) {
            return tile.id !== tileId
          })
        })
        onJoined?.()
      } catch {
        toast.error('加入集合失败')
      }
    },
    [collectionId, onJoined, toUpdateMagneticTile]
  )

  const handlePrevent = useCallback(function (e: React.MouseEvent<HTMLElement>) {
    e.stopPropagation()
    e.preventDefault()
  }, [])

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        overlayClassName={`${BELOW_CAPTION} bg-black/25 supports-backdrop-filter:backdrop-blur-xs`}
        className={[
          BELOW_CAPTION,
          'w-[min(420px,94vw)] max-w-none gap-0 overflow-visible p-4 sm:max-w-none',
          // 外壳不裁切；仅下方列表自己滚动，避免 Input focus ring 被 overflow 切边
          '**:data-[slot=dialog-body]:flex **:data-[slot=dialog-body]:min-h-0 **:data-[slot=dialog-body]:flex-1',
          '**:data-[slot=dialog-body]:flex-col **:data-[slot=dialog-body]:gap-3',
          '**:data-[slot=dialog-body]:overflow-visible **:data-[slot=dialog-body]:px-1 **:data-[slot=dialog-body]:pb-0'
        ].join(' ')}>
        <SheetTitle className="sr-only">新增网址</SheetTitle>
        <SheetDescription className="sr-only">
          点选未归组的网址磁贴，即可加入当前集合
        </SheetDescription>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            value={keyword}
            placeholder="搜索磁贴"
            aria-label="搜索磁贴"
            className="min-w-0 flex-1"
            onChange={function (event) {
              onUpdateKeyword(event.target.value)
            }}
          />
          <SheetClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭"
                className="size-9 shrink-0"
              />
            }>
            <Icon
              icon="lucide:x"
              aria-hidden
            />
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1 scrollbar-thin">
          {queriedMagneticTiles.length ? (
            <Controller
              onPick={handlePick}
              onPrevent={handlePrevent}
              magneticTiles={queriedMagneticTiles}
              density="compact"
            />
          ) : (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              {keyword.trim()
                ? '无匹配磁贴，试试其它关键词'
                : '暂无可加入的网址磁贴，可先在主镜添加导航磁贴'}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { AddSheet }
export type { AddSheetProps }
