import { Button } from '@i-thinking/design/components/button'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  FILTER_PRESETS,
  STICKER_LIBRARY,
  formatTimecode
} from '@/views/clipchamp/lib/project'
import { useGalleryBridge } from '@/views/clipchamp/lib/gallery-bridge.ts'
import { AssetThumb } from '@/views/clipchamp/workspace/asset-thumb.tsx'

function MediaPanel() {
  const mediaPanel = useClipchampStore(function (s) {
    return s.mediaPanel
  })
  const assets = useClipchampStore(function (s) {
    return s.assets
  })
  const importMedia = useClipchampStore(function (s) {
    return s.importMedia
  })
  const addAssetToTimeline = useClipchampStore(function (s) {
    return s.addAssetToTimeline
  })
  const addTextClip = useClipchampStore(function (s) {
    return s.addTextClip
  })
  const addSticker = useClipchampStore(function (s) {
    return s.addSticker
  })
  const patchSelected = useClipchampStore(function (s) {
    return s.patchSelected
  })
  const captureUndoPoint = useClipchampStore(function (s) {
    return s.captureUndoPoint
  })
  const selectedClipId = useClipchampStore(function (s) {
    return s.selectedClipId
  })

  const galleryVideos = useGalleryBridge()

  const title =
    mediaPanel === 'media'
      ? '我的媒体'
      : mediaPanel === 'text'
        ? '文本'
        : mediaPanel === 'stickers'
          ? '贴纸'
          : mediaPanel === 'transitions'
            ? '转场'
            : '音频'

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center border-b border-border/80 px-3">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {mediaPanel === 'media' ? (
            <>
              <Button
                type="button"
                className="h-9 w-full gap-2 shadow-none"
                onClick={function () {
                  void importMedia()
                }}>
                <Icon
                  icon="lucide:upload"
                  className="size-4"
                />
                导入媒体
              </Button>

              {assets.length === 0 ? (
                <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border/90 bg-muted/20 px-3 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-muted/60">
                    <Icon
                      icon="lucide:film"
                      className="size-6 text-muted-foreground"
                    />
                  </div>
                  <p className="max-w-[12rem] text-xs leading-relaxed text-muted-foreground">
                    拖入或导入视频、音频、图片
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {assets.map(function (asset) {
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        draggable
                        className="group relative overflow-hidden rounded-lg border border-border/80 bg-muted/30 text-left transition hover:border-primary/60 hover:shadow-sm"
                        onDragStart={function (event) {
                          event.dataTransfer.setData('text/clipchamp-asset', asset.id)
                        }}
                        onDoubleClick={function (event) {
                          addAssetToTimeline(asset.id, event.altKey ? 'overlay' : undefined)
                        }}
                        title="拖拽或双击添加；Alt+双击为画中画">
                        <div className="relative aspect-video overflow-hidden bg-black/80">
                          <AssetThumb asset={asset} />
                          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[10px] text-white">
                            {formatTimecode(asset.durationMs)}
                          </span>
                        </div>
                        <div className="truncate px-1.5 py-1.5 text-[11px] text-muted-foreground">
                          {asset.name}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {galleryVideos.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    图库视频
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {galleryVideos.slice(0, 8).map(function (item) {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="rounded-lg border border-border/80 px-2 py-2 text-left text-[11px] transition hover:border-primary/60"
                          onClick={function () {
                            void useClipchampStore.getState().importFromGallery(item)
                          }}>
                          <div className="truncate font-medium">{item.name}</div>
                          <div className="text-muted-foreground">加入素材库</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {mediaPanel === 'text' ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="h-9 shadow-none"
                onClick={function () {
                  addTextClip('标题文字')
                }}>
                添加标题
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 shadow-none"
                onClick={function () {
                  addTextClip('副标题')
                }}>
                添加副标题
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 shadow-none"
                onClick={function () {
                  useClipchampStore.getState().addCaptionCue('字幕内容')
                }}>
                添加字幕
              </Button>
            </div>
          ) : null}

          {mediaPanel === 'stickers' ? (
            <div className="grid grid-cols-4 gap-2">
              {STICKER_LIBRARY.map(function (sticker) {
                return (
                  <button
                    key={sticker.id}
                    type="button"
                    className="flex aspect-square items-center justify-center rounded-lg border border-border/80 bg-muted/20 text-2xl transition hover:border-primary/60 hover:bg-primary/5"
                    title={sticker.label}
                    onClick={function () {
                      addSticker(sticker.id)
                    }}>
                    {sticker.emoji}
                  </button>
                )
              })}
            </div>
          ) : null}

          {mediaPanel === 'transitions' ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">选中片段后应用转场（淡化 / 叠化）</p>
              {(
                [
                  { kind: 'none', label: '无' },
                  { kind: 'fade', label: '淡化' },
                  { kind: 'dissolve', label: '叠化' }
                ] as const
              ).map(function (item) {
                return (
                  <Button
                    key={item.kind}
                    type="button"
                    variant="outline"
                    className="h-8 justify-start shadow-none"
                    disabled={!selectedClipId}
                    onClick={function () {
                      captureUndoPoint()
                      patchSelected({
                        transition: {
                          kind: item.kind,
                          durationMs: item.kind === 'none' ? 0 : 500
                        },
                        fadeInMs: item.kind === 'none' ? 0 : 400,
                        fadeOutMs: item.kind === 'none' ? 0 : 400
                      })
                    }}>
                    {item.label}
                  </Button>
                )
              })}
              <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                滤镜预设
              </p>
              {FILTER_PRESETS.map(function (preset) {
                return (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="ghost"
                    className="h-8 justify-start"
                    disabled={!selectedClipId}
                    onClick={function () {
                      captureUndoPoint()
                      patchSelected({ filter: { ...preset.filter } })
                    }}>
                    {preset.label}
                  </Button>
                )
              })}
            </div>
          ) : null}

          {mediaPanel === 'audio' ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="h-9 shadow-none"
                onClick={function () {
                  void importMedia()
                }}>
                导入音频
              </Button>
              <div className="grid grid-cols-1 gap-2">
                {assets
                  .filter(function (asset) {
                    return asset.kind === 'audio'
                  })
                  .map(function (asset) {
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={clsx(
                          'flex items-center gap-2 rounded-lg border border-border/80 px-2.5 py-2 text-left text-xs transition hover:border-primary/60'
                        )}
                        onDoubleClick={function () {
                          addAssetToTimeline(asset.id, 'audio')
                        }}>
                        <Icon
                          icon="lucide:music"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="truncate">{asset.name}</span>
                      </button>
                    )
                  })}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

export { MediaPanel }
