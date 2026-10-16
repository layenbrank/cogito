import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save as dialogSave } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { findPruneHints } from '@/features/capture/model/prune-hints'
import { formatUsageBytes } from '@/features/capture/model/usage'
import { CHANNELS } from '@/shared/ipc/channels'
import { useAlbumStore } from '@/stores/album'
import { buildChange, useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/setting'
import { DateScrubber } from '@/views/gallery/library/date-scrubber'
import { MediaGrid } from '@/views/gallery/library/media-grid'
import { findScrubberMarks } from '@/views/gallery/library/time-buckets'
import { useGalleryScroll } from '@/views/gallery/library/use-gallery-scroll'
import { Lightbox } from '@/views/gallery/lightbox/lightbox'
import type { CaptureKind, GalleryMedia } from '@/views/gallery/model/media'

interface CapturePaneProps {
  kind: CaptureKind
  medias: GalleryMedia[]
  albumID: string | null
  emptyHint: string
  emptyAction?: ReactNode
}

function CapturePane(props: CapturePaneProps) {
  const retention = useSettingsStore(function (state) {
    return state.settings.capture.retention
  })
  const toReadMedias = useGalleryStore(function (state) {
    return state.toReadMedias
  })
  const albums = useAlbumStore(function (state) {
    return state.albums
  })
  const toAttachAlbum = useAlbumStore(function (state) {
    return state.toAttachAlbum
  })
  const toDetachAlbum = useAlbumStore(function (state) {
    return state.toDetachAlbum
  })

  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollRoot, onScrollRoot] = useState<HTMLElement | null>(null)
  const scrollFxRef = useGalleryScroll(scrollRoot)

  useEffect(function () {
    onScrollRoot(scrollerRef.current)
  }, [])

  const [selecting, onSelecting] = useState(false)
  const [selectedIds, onSelectedIds] = useState<Set<string>>(function () {
    return new Set()
  })
  const [lightboxId, onLightboxId] = useState<string | null>(null)
  const [isLightboxOpen, onLightboxOpen] = useState(false)

  const scoped = useMemo(
    function () {
      return props.medias.filter(function (media) {
        return (media.meta.captureKind ?? 'screenshot') === props.kind
      })
    },
    [props.kind, props.medias]
  )

  const hints = useMemo(
    function () {
      return findPruneHints(scoped, retention)
    },
    [retention, scoped]
  )

  const marks = useMemo(
    function () {
      return findScrubberMarks(scoped)
    },
    [scoped]
  )

  function toggleSelect(media: GalleryMedia) {
    onSelectedIds(function (prev) {
      const next = new Set(prev)
      if (next.has(media.asset.id)) next.delete(media.asset.id)
      else next.add(media.asset.id)
      return next
    })
  }

  function findBadge(media: GalleryMedia): ReactNode {
    if (media.meta.keep) return null
    const hint = hints.get(media.asset.id)
    if (!hint?.willPrune) {
      if (hint?.daysLeft !== undefined && hint.daysLeft <= 7) {
        return (
          <span className="inline-flex items-center gap-0.5 rounded bg-warning/90 px-1 py-0.5 text-[10px] leading-none text-warning-foreground">
            <Icon icon="lucide:clock" className="size-2.5" aria-hidden />
            {hint.daysLeft} 天后清理
          </span>
        )
      }
      return null
    }
    const label =
      hint.reason === 'days'
        ? '即将清理'
        : hint.reason === 'count'
          ? '超出数量'
          : '超出容量'
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-warning px-1 py-0.5 text-[10px] leading-none text-warning-foreground">
        <Icon icon="lucide:triangle-alert" className="size-2.5" aria-hidden />
        {label}
      </span>
    )
  }

  async function patchKeep(ids: string[], keep: boolean) {
    const medias = useGalleryStore.getState().medias
    const idSet = new Set(ids)
    const targets = medias.filter(function (media) {
      return idSet.has(media.asset.id)
    })
    if (targets.length === 0) return
    await invoke(CHANNELS.ASSET.UPDATE, {
      params:
        targets.length === 1
          ? {
              id: targets[0].asset.id,
              updates: buildChange(targets[0].asset, { keep })
            }
          : targets.map(function (media) {
              return {
                id: media.asset.id,
                updates: buildChange(media.asset, { keep })
              }
            })
    })
    await toReadMedias({ skipHydrate: true })
    toast.success(keep ? '已保存，不会被自动清理' : '已取消保存')
  }

  async function removeSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const medias = useGalleryStore.getState().medias
    const mediaById = new Map(
      medias.map(function (media) {
        return [media.asset.id, media]
      })
    )
    for (const id of ids) {
      const media = mediaById.get(id)
      if (media?.meta.isManaged) {
        try {
          const { remove } = await import('@tauri-apps/plugin-fs')
          await remove(media.asset.filePath)
        } catch (error) {
          console.warn('[capture] remove file failed', error)
        }
      }
    }
    await invoke(CHANNELS.ASSET.REMOVE, {
      params:
        ids.length === 1
          ? { id: ids[0] }
          : ids.map(function (id) {
              return { id }
            })
    })
    onSelectedIds(new Set())
    onSelecting(false)
    await toReadMedias({ skipHydrate: true })
    toast.success(`已删除 ${ids.length} 项`)
  }

  async function copySelected() {
    const id = Array.from(selectedIds)[0]
    if (!id) return
    const media = scoped.find(function (item) {
      return item.asset.id === id
    })
    if (!media) return
    try {
      if (media.kind === 'image') {
        const bytes = await readFile(media.asset.filePath)
        await writeImage(bytes)
      } else {
        await writeText(media.asset.filePath)
      }
      toast.success('已复制')
    } catch (error) {
      toast.error(`复制失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function saveSelected() {
    const id = Array.from(selectedIds)[0]
    if (!id) return
    const media = scoped.find(function (item) {
      return item.asset.id === id
    })
    if (!media) return
    const dest = await dialogSave({
      defaultPath: media.asset.fileName
    })
    if (!dest) return
    try {
      const { copyFile } = await import('@tauri-apps/plugin-fs')
      await copyFile(media.asset.filePath, dest)
      toast.success('已另存为')
    } catch (error) {
      toast.error(`另存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function attachToAlbum(albumID: string) {
    await toAttachAlbum(Array.from(selectedIds), albumID)
    toast.success('已加入相簿')
  }

  async function detachFromAlbum(albumID: string) {
    await toDetachAlbum(Array.from(selectedIds), albumID)
    toast.success('已移出相簿')
  }

  if (scoped.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground">{props.emptyHint}</p>
        {props.emptyAction}
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
        <Button
          variant={selecting ? 'default' : 'outline'}
          size="sm"
          className="h-6 rounded-sm px-2 text-xs"
          onClick={function () {
            onSelecting(function (value) {
              return !value
            })
            onSelectedIds(new Set())
          }}>
          {selecting ? '完成' : '选择'}
        </Button>
        {selecting && selectedIds.size > 0 ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-sm px-2 text-xs"
              onClick={function () {
                void patchKeep(Array.from(selectedIds), true)
              }}>
              标记保存
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-sm px-2 text-xs"
              onClick={function () {
                void patchKeep(Array.from(selectedIds), false)
              }}>
              取消保存
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-sm px-2 text-xs"
              onClick={function () {
                void copySelected()
              }}>
              复制
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-sm px-2 text-xs"
              onClick={function () {
                void saveSelected()
              }}>
              另存为
            </Button>
            {albums.length > 0 ? (
              <select
                className="h-6 rounded-sm border border-input bg-background px-1.5 text-xs"
                aria-label="加入相簿"
                defaultValue=""
                onChange={function (event) {
                  const value = event.target.value
                  if (!value) return
                  void attachToAlbum(value)
                  event.target.value = ''
                }}>
                <option value="">加入相簿…</option>
                {albums.map(function (album) {
                  return (
                    <option key={album.id} value={album.id}>
                      {album.name}
                    </option>
                  )
                })}
              </select>
            ) : null}
            {props.albumID && props.albumID !== 'uncategorized' ? (
              <Button
                variant="outline"
                size="sm"
                className="h-6 rounded-sm px-2 text-xs"
                onClick={function () {
                  if (props.albumID) void detachFromAlbum(props.albumID)
                }}>
                移出相簿
              </Button>
            ) : null}
            <Button
              variant="destructive"
              size="sm"
              className="h-6 rounded-sm px-2 text-xs"
              onClick={function () {
                void removeSelected()
              }}>
              删除
            </Button>
            <span className="text-xs text-muted-foreground">已选 {selectedIds.size}</span>
          </>
        ) : null}
        {props.kind === 'recording' ? (
          <span className="ml-auto text-xs text-muted-foreground">
            清理只移除记录，不会删除你原位置的文件
          </span>
        ) : null}
      </div>

      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-y-auto px-2">
        <MediaGrid
          medias={scoped}
          scope="all"
          columns={5}
          selecting={selecting}
          selectedIds={selectedIds}
          onOpen={function (media) {
            onLightboxId(media.asset.id)
            onLightboxOpen(true)
          }}
          onToggleSelect={toggleSelect}
          findBadge={findBadge}
          isKept={function (media) {
            return media.meta.keep === true
          }}
        />
        <DateScrubber marks={marks} scrollRoot={scrollRoot} scrollFxRef={scrollFxRef} />
      </div>

      <Lightbox
        open={isLightboxOpen}
        medias={scoped}
        initialId={lightboxId}
        onOpenChange={onLightboxOpen}
      />

      {props.kind === 'recording' && scoped[0] ? (
        <p className="sr-only">
          {formatUsageBytes(scoped.reduce(function (sum, media) {
            return sum + (media.asset.size ?? 0)
          }, 0))}
        </p>
      ) : null}
    </div>
  )
}

export { CapturePane }
export type { CapturePaneProps }
