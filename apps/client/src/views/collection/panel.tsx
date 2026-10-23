import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
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
          if (host?.title) onUpdateTitle(host.title)
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
    [currentId, membersToken]
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

  const canGoBack = stack.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
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
          <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={function () {
              void (async function () {
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
                  toast.error('无法打开书签文件夹')
                }
              })()
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
            <TooltipContent side="bottom">新增网址</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 scrollbar-thin">
        {magneticTiles.length ? (
          <Controller
            magneticTiles={magneticTiles}
            onPick={handlePick}
            onRemove={handleRemove}
          />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            暂无内容，点击右上角新增网址
          </p>
        )}
      </div>

      <OverlayDrawer
        id={currentId}
        visible={drawerVisible}
        onUpdateVisible={onUpdateDrawerVisible}
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

export { CollectionPanel }
export type { CollectionPanelProps }
