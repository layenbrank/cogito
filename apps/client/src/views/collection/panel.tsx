import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import { useCollectionStore } from '@/stores/collection'
import { useMirrorStore } from '@/stores/mirror'
import { Controller } from '@/views/collection/controller.tsx'
import { OverlayDrawer } from '@/views/collection/drawer.tsx'

interface CollectionPanelProps {
  id: string
}

function CollectionPanel(props: CollectionPanelProps) {
  const [drawerVisible, onUpdateDrawerVisible] = useState(false)
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])
  const [title, onUpdateTitle] = useState('集合')
  const toUpdateMagneticTile = useMirrorStore(function (state) {
    return state.toUpdateMagneticTile
  })
  const toBumpRevision = useCollectionStore(function (state) {
    return state.toBumpRevision
  })

  const toLoadMembers = useCallback(
    async function () {
      try {
        const [members, hosts] = await Promise.all([
          invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
            params: { collectionID: props.id }
          }),
          invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
            params: { id: props.id }
          })
        ])
        onUpdateMagneticTiles(
          members.toSorted(function (a, b) {
            return a.index - b.index
          })
        )
        const [host] = hosts
        if (host?.title) onUpdateTitle(host.title)
      } catch {
        onUpdateMagneticTiles([])
        toast.error('集合成员加载失败')
      }
    },
    [props.id]
  )

  useEffect(
    function () {
      void toLoadMembers()
    },
    [toLoadMembers]
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
        toast.error('移出集合失败')
      }
    },
    [toUpdateMagneticTile, toBumpRevision]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="新增磁贴"
                className="size-10 rounded-md text-muted-foreground"
                onClick={function () {
                  onUpdateDrawerVisible(true)
                }}
              />
            }>
            <Icon
              icon="lucide:plus"
              aria-hidden
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">新增磁贴</TooltipContent>
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin]">
        {magneticTiles.length ? (
          <Controller
            magneticTiles={magneticTiles}
            onRemove={handleRemove}
          />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            暂无导航磁贴，点击右上角新增
          </p>
        )}
      </div>

      <OverlayDrawer
        id={props.id}
        visible={drawerVisible}
        onUpdateVisible={onUpdateDrawerVisible}
        onJoined={function () {
          void toLoadMembers()
          toBumpRevision()
        }}
      />
    </div>
  )
}

export { CollectionPanel }
export type { CollectionPanelProps }
