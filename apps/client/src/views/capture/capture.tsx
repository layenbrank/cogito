/**
 * 捕获库布局：顶栏（截屏/录屏分段、占用条、清理）+ 相簿侧栏 + 主内容。
 * 壳层常驻；tab 只换 kind / 列表数据，不经 Outlet 卸挂整树。
 * 分区靠背景层次与间距，不用细灰线；控件约 h-8~h-9。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { pickAndImportRecordings } from '@/features/capture/import-recording'
import {
  buildCaptureByteSeries,
  findCaptureUsage
} from '@/features/capture/model/usage'
import { UsageMeter } from '@/features/capture/model/usage-meter'
import { runCapturePrune } from '@/features/capture/retention'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { useShellSurface } from '@/features/window-shell/slots'
import { useAlbumStore } from '@/stores/album'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/setting'
import { CapturePane } from '@/views/capture/capture-pane'
import { findCaptureHistory, type CaptureKind } from '@/views/gallery/model/media'

const SIDE_ITEM =
  'flex h-8 w-full items-center rounded-md px-2.5 text-left text-xs transition-colors'

/** Tabs 指示块去描边，用主题适配 soft shadow 分界 */
const TABS_LIST_SURFACE =
  '[&_[data-slot=tabs-indicator]]:border-0 [&_[data-slot=tabs-indicator]]:shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_0_0_1px_color-mix(in_oklab,var(--border)_40%,transparent)]'

function CaptureCaptionTitle() {
  const showsSession = useShowsTileSession()
  if (showsSession) return null
  return <span className="text-sm font-medium">{findComponentLabel('capture')}</span>
}

function CaptureLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const kind: CaptureKind = location.pathname.includes('/recording') ? 'recording' : 'screenshot'
  const tab = kind

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
  const [isImporting, onImporting] = useState(false)

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

  const screenshotPoints = useMemo(
    function () {
      return buildCaptureByteSeries(history, 'screenshot')
    },
    [history]
  )

  const recordingPoints = useMemo(
    function () {
      return buildCaptureByteSeries(history, 'recording')
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

  async function onImportRecordings() {
    onImporting(true)
    try {
      const ids = await pickAndImportRecordings()
      if (ids.length > 0) {
        await toReadMedias({ skipHydrate: true })
        toast.success(`已导入 ${ids.length} 个录屏`)
      }
    } catch (error) {
      toast.error(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      onImporting(false)
    }
  }

  const importAction =
    kind === 'recording' ? (
      <Button
        size="default"
        className="gap-1 text-xs"
        disabled={isImporting}
        onClick={function () {
          void onImportRecordings()
        }}>
        导入录屏
      </Button>
    ) : null

  useShellSurface({
    scrollable: false,
    className: 'bg-background',
    begin: <CaptureCaptionTitle />
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 bg-muted/30 px-3 py-2.5">
        <Tabs
          value={tab}
          onValueChange={function (value) {
            void navigate(value === 'recording' ? '/capture/recording' : '/capture')
          }}>
          <TabsList className={TABS_LIST_SURFACE}>
            <TabsTrigger
              value="screenshot"
              className="gap-1.5 px-3 text-xs">
              <Icon
                icon="lucide:camera"
                className="size-3.5"
                aria-hidden
              />
              截屏
            </TabsTrigger>
            <TabsTrigger
              value="recording"
              className="gap-1.5 px-3 text-xs">
              <Icon
                icon="lucide:clapperboard"
                className="size-3.5"
                aria-hidden
              />
              录屏
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
          <UsageMeter
            label="截屏"
            used={usage.screenshot.bytes}
            max={retention.screenshot.maxBytes}
            count={usage.screenshot.count}
            maxCount={retention.screenshot.count}
            unitLabel="张"
            points={screenshotPoints}
          />
          <UsageMeter
            label="录屏"
            used={usage.recording.bytes}
            max={retention.recording.maxBytes}
            count={usage.recording.count}
            maxCount={retention.recording.count}
            unitLabel="个"
            points={recordingPoints}
          />
        </div>

        <Button
          variant="secondary"
          size="default"
          className="shrink-0 gap-1.5 text-xs"
          disabled={isPruning}
          onClick={function () {
            void onPruneNow()
          }}>
          <Icon
            icon="lucide:trash-2"
            className="size-3.5"
            aria-hidden
          />
          立即清理
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-48 shrink-0 flex-col bg-sidebar">
          <div className="flex h-9 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            相簿
          </div>
          <nav
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-y-contain px-2 pb-2"
            aria-label="相簿">
            <Button
              type="button"
              variant="ghost"
              className={cn(
                SIDE_ITEM,
                albumID === null
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
              )}
              onClick={function () {
                onAlbumID(null)
              }}>
              全部
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                SIDE_ITEM,
                albumID === 'uncategorized'
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
              )}
              onClick={function () {
                onAlbumID('uncategorized')
              }}>
              未分类
            </Button>
            {albums.map(function (album) {
              return (
                <div
                  key={album.id}
                  className="group flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      SIDE_ITEM,
                      'min-w-0 flex-1',
                      albumID === album.id
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
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
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="invisible shrink-0 text-muted-foreground group-hover:visible hover:text-destructive"
                    aria-label={`删除相簿 ${album.name}`}
                    onClick={function () {
                      void toRemoveAlbum(album.id)
                      if (albumID === album.id) onAlbumID(null)
                    }}>
                    <Icon
                      icon="lucide:trash-2"
                      className="size-3.5"
                    />
                  </Button>
                </div>
              )
            })}
          </nav>
          <div className="flex gap-1.5 bg-sidebar-accent/25 p-2.5">
            <Input
              className="h-8 border-0 bg-background/80 px-2.5 text-xs shadow-[0_0_0_1px_color-mix(in_oklab,var(--border)_45%,transparent)]"
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
              size="default"
              className="shrink-0 px-3 text-xs"
              onClick={function () {
                void onCreateAlbum()
              }}>
              添加
            </Button>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 bg-background">
          <CapturePane
            kind={kind}
            medias={scopedMedias}
            albumID={albumID}
            emptyHint={
              kind === 'recording'
                ? '还没有录屏。可以导入本机视频；清理只移除记录，不会删除原位置文件。'
                : '还没有截屏。用快捷键或磁贴截一张吧。'
            }
            emptyAction={importAction}
            toolbarEnd={importAction}
          />
        </main>
      </div>
    </div>
  )
}

export default CaptureLayout
