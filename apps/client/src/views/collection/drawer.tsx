import { Dialog, DialogContent } from '@i-thinking/design/components/dialog'
import { Input } from '@i-thinking/design/components/input'
import { invoke } from '@tauri-apps/api/core'
import Fuse from 'fuse.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import { Controller } from '@/views/collection/controller.tsx'

interface OverlayDrawerProps {
  id: string
  visible: boolean
  onUpdateVisible: (value: boolean) => void
}

/** 集合右侧抽屉：搜索全量磁贴，点卡片即加入当前集合 */
function OverlayDrawer(props: OverlayDrawerProps) {
  const [keyword, onUpdateKeyword] = useState('')
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])

  useEffect(function () {
    let cancelled = false

    async function toLoad() {
      try {
        const result = await invoke<MagneticTile[]>(CHANNELS.COLLECTION.READS)
        if (cancelled) return

        onUpdateMagneticTiles(result ?? [])
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
  }, [])

  const queriedMagneticTiles = useMemo(
    function () {
      if (!keyword.trim().length) return magneticTiles ?? []

      const fuse = new Fuse(magneticTiles ?? [], {
        keys: ['title', 'url'],
        threshold: 0.4
      })

      const result = fuse.search(keyword)

      return result.map((v) => v.item)
    },
    [magneticTiles, keyword]
  )

  const handleIncrement = useCallback(
    function (e: React.MouseEvent<HTMLElement>) {
      const event = e.nativeEvent
      const target = event.target as HTMLElement

      const closest = target.closest<HTMLElement>('.magnetic-tile')
      if (!closest) return

      const ID = closest.getAttribute('data-id')
      if (!ID) {
        toast.error('磁贴 ID 未定义，无法新增磁贴')
        return
      }

      void invoke(CHANNELS.MAGNETIC_TILE.UPDATE, {
        params: { key: ID, change: { collectionID: props.id } }
      })

      onUpdateMagneticTiles(function (prev) {
        return prev.filter(function (magneticTile) {
          return magneticTile.id !== ID
        })
      })
    },
    [props.id]
  )

  const handlePrevent = useCallback(function (e: React.MouseEvent<HTMLElement>) {
    const event = e.nativeEvent
    event.stopPropagation()
    event.preventDefault()
  }, [])

  return (
    <Dialog
      open={props.visible}
      onOpenChange={props.onUpdateVisible}>
      <DialogContent
        showCloseButton={false}
        className="top-0 right-0 bottom-0 left-auto h-full w-[30%] max-h-none max-w-none -translate-x-0 -translate-y-0 gap-3 rounded-none rounded-l-xl p-3 sm:max-w-none">
        <Input
          value={keyword}
          placeholder="搜索磁贴"
          aria-label="搜索磁贴"
          onChange={function (event) {
            onUpdateKeyword(event.target.value)
          }}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <Controller
            onClick={handleIncrement}
            onPrevent={handlePrevent}
            magneticTiles={queriedMagneticTiles}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { OverlayDrawer, type OverlayDrawerProps }
