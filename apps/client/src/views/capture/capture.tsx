/**
 * 捕获库布局：顶栏（截屏/录屏分段、占用条、清理）+ 相簿侧栏 + Outlet。
 * 控件密度对齐 gallery / code（h-6~h-7、text-xs），不用 min-h-11。
 */
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Tabs, TabsList, TabsTrigger } from '@i-thinking/design/components/tabs'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { findCaptureUsage } from '@/features/capture/model/usage'
import { UsageMeter } from '@/features/capture/model/usage-meter'
import { runCapturePrune } from '@/features/capture/retention'
import { useAlbumStore } from '@/stores/album'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/setting'
import { findCaptureHistory } from '@/views/gallery/model/media'

const SIDE_ITEM =
  'flex h-7 w-full items-center rounded-sm px-1.5 text-left text-xs transition-colors'

function CaptureLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const isRecording = location.pathname.includes('/recording')
  const tab = isRecording ? 'recording' : 'screenshot'

  const medias = useGalleryStore(function (state) {
    return state.medias
  })
  const toReadMedias = useGalleryStore(function (state) {
    return state.toReadMedias
  })
  const albums = useAlbumStore(function (state) {
    return state.albums
  })
  const toReadAlbums = useAlbumStore(function (state) {
    return state.toReadAlbums
  })
  const toWriteAlbum = useAlbumStore(function (state) {
    return state.toWriteAlbum
  })
  const toUpdateAlbum = useAlbumStore(function (state) {
    return state.toUpdateAlbum
  })
  const toRemoveAlbum = useAlbumStore(function (state) {
    return state.toRemoveAlbum
  })
  const retention = useSettingsStore(function (state) {
    return state.settings.capture.retention
  })

  const [albumID, onAlbumID] = useState<string | null>(null)
  const [albumDraft, onAlbumDraft] = useState('')
  const [isPruning, onPruning] = useState(false)

  useEffect(
    function () {
      void useSettingsStore.getState().toInitialize()
      void toReadMedias()
      void toReadAlbums()
      void runCapturePrune({ silent: true })
    },
    [toReadAlbums, toReadMedias]
  )

  const history = useMemo(
    function () {
      return findCaptureHistory(medias)
    },
    [medias]
  )

  const usage = useMemo(
    function () {
      return findCaptureUsage(history)
    },
    [history]
  )

  const scopedMedias = useMemo(
    function () {
      if (albumID === null) return history
      if (albumID === 'uncategorized') {
        return history.filter(function (media) {
          return !media.meta.albums || media.meta.albums.length === 0
        })
      }
      return history.filter(function (media) {
        return Boolean(media.meta.albums?.includes(albumID))
      })
    },
    [albumID, history]
  )

  async function onPruneNow() {
    onPruning(true)
    try {
      const result = await runCapturePrune({ force: true })
      await toReadMedias({ skipHydrate: true })
      if (result && result.ids.length === 0) {
        toast.message('没有需要清理的项目')
      }
    } finally {
      onPruning(false)
    }
  }

  async function onCreateAlbum() {
    const name = albumDraft.trim()
    if (!name) return
    const id = await toWriteAlbum({ name })
    onAlbumDraft('')
    if (id) onAlbumID(id)
  }

  return (
    <Decorations
      scrollable={false}
      className="bg-background"
      begin={<span className="text-sm font-medium">{findComponentLabel('capture')}</span>}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <Tabs
            value={tab}
            onValueChange={function (value) {
              void navigate(value === 'recording' ? '/capture/recording' : '/capture')
            }}>
            <TabsList className="h-7">
              <TabsTrigger
                value="screenshot"
                className="h-6 gap-1 px-2 text-xs">
                <Icon
                  icon="lucide:camera"
                  className="size-3"
                  aria-hidden
                />
                截屏
              </TabsTrigger>
              <TabsTrigger
                value="recording"
                className="h-6 gap-1 px-2 text-xs">
                <Icon
                  icon="lucide:clapperboard"
                  className="size-3"
                  aria-hidden
                />
                录屏
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-2">
            <UsageMeter
              label="截屏"
              used={usage.screenshot.bytes}
              max={retention.screenshot.maxBytes}
              count={usage.screenshot.count}
              maxCount={retention.screenshot.count}
              unitLabel="张"
            />
            <UsageMeter
              label="录屏"
              used={usage.recording.bytes}
              max={retention.recording.maxBytes}
              count={usage.recording.count}
              maxCount={retention.recording.count}
              unitLabel="个"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 gap-1 rounded-sm px-2 text-xs"
            disabled={isPruning}
            onClick={function () {
              void onPruneNow()
            }}>
            <Icon
              icon="lucide:trash-2"
              className="size-3"
              aria-hidden
            />
            立即清理
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-sidebar">
            <div className="text-muted-foreground flex h-7 shrink-0 items-center px-2 text-[11px] font-semibold tracking-wider uppercase">
              相簿
            </div>
            <nav
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-1"
              aria-label="相簿">
              <button
                type="button"
                className={cn(
                  SIDE_ITEM,
                  albumID === null
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
                )}
                onClick={function () {
                  onAlbumID(null)
                }}>
                全部
              </button>
              <button
                type="button"
                className={cn(
                  SIDE_ITEM,
                  albumID === 'uncategorized'
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
                )}
                onClick={function () {
                  onAlbumID('uncategorized')
                }}>
                未分类
              </button>
              {albums.map(function (album) {
                return (
                  <div
                    key={album.id}
                    className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      className={cn(
                        SIDE_ITEM,
                        'min-w-0 flex-1',
                        albumID === album.id
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
                      )}
                      onClick={function () {
                        onAlbumID(album.id)
                      }}
                      onDoubleClick={function () {
                        const next = window.prompt('相簿名称', album.name)
                        if (next && next.trim() && next.trim() !== album.name) {
                          void toUpdateAlbum(album.id, { name: next.trim() })
                        }
                      }}>
                      <span className="truncate">{album.name}</span>
                    </button>
                    <button
                      type="button"
                      className="invisible flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover:visible hover:text-destructive"
                      aria-label={`删除相簿 ${album.name}`}
                      onClick={function () {
                        void toRemoveAlbum(album.id)
                        if (albumID === album.id) onAlbumID(null)
                      }}>
                      <Icon
                        icon="lucide:trash-2"
                        className="size-3"
                      />
                    </button>
                  </div>
                )
              })}
            </nav>
            <div className="flex gap-1 border-t border-sidebar-border p-1.5">
              <Input
                className="h-6 px-1.5 text-xs"
                value={albumDraft}
                placeholder="新建相簿"
                aria-label="新建相簿"
                onChange={function (event) {
                  onAlbumDraft(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key === 'Enter') void onCreateAlbum()
                }}
              />
              <Button
                size="sm"
                className="h-6 shrink-0 rounded-sm px-2 text-xs"
                onClick={function () {
                  void onCreateAlbum()
                }}>
                添加
              </Button>
            </div>
          </aside>

          <main className="min-h-0 min-w-0 flex-1">
            <Outlet context={{ albumID, medias: scopedMedias }} />
          </main>
        </div>
      </div>
    </Decorations>
  )
}

export default CaptureLayout
