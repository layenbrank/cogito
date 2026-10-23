import { Sheet, SheetContent, SheetTitle } from '@cogito/design/components/sheet'
import { Input } from '@cogito/design/components/input'
import { invoke } from '@tauri-apps/api/core'
import Fuse from 'fuse.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import { useMirrorStore } from '@/stores/mirror'
import { Controller } from '@/views/collection/controller.tsx'

interface OverlayDrawerProps {
  id: string
  visible: boolean
  onUpdateVisible: (value: boolean) => void
  /** 加入成功后刷新面板成员 */
  onJoined?: () => void
}

const FUSE_OPTIONS = {
  keys: ['title', 'url'] as const,
  threshold: 0.4
}

/** 集合右侧抽屉：搜索未归组 navigation 磁贴，点卡片即加入当前集合 */
function OverlayDrawer(props: OverlayDrawerProps) {
  const [keyword, onUpdateKeyword] = useState('')
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])
  const toUpdateMagneticTile = useMirrorStore(function (state) {
    return state.toUpdateMagneticTile
  })

  useEffect(
    function () {
      if (!props.visible) return

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
    [props.visible]
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
      open={props.visible}
      onOpenChange={props.onUpdateVisible}>
      <SheetContent
        side="right"
        showCloseButton={false}
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className={[
          'w-[min(360px,36vw)] max-w-none gap-0 p-3 sm:max-w-none',
          '**:data-[slot=dialog-body]:flex **:data-[slot=dialog-body]:min-h-0 **:data-[slot=dialog-body]:flex-1',
          '**:data-[slot=dialog-body]:flex-col **:data-[slot=dialog-body]:gap-3 **:data-[slot=dialog-body]:overflow-hidden',
          '**:data-[slot=dialog-body]:p-0 **:data-[slot=dialog-body]:pb-0'
        ].join(' ')}>
        <SheetTitle className="sr-only">新增磁贴到集合</SheetTitle>
        <Input
          value={keyword}
          placeholder="搜索磁贴"
          aria-label="搜索磁贴"
          className="shrink-0"
          onChange={function (event) {
            onUpdateKeyword(event.target.value)
          }}
        />
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2 scrollbar-thin">
          <Controller
            onPick={handlePick}
            onPrevent={handlePrevent}
            magneticTiles={queriedMagneticTiles}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { OverlayDrawer, type OverlayDrawerProps }
