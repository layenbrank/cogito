import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { findPruneHints } from '@/features/capture/model/prune-hints'
import { formatUsageBytes } from '@/features/capture/model/usage'
import { useAlbumStore } from '@/stores/album'
import { useSettingsStore } from '@/stores/setting'
import { DateScrubber } from '@/views/gallery/library/date-scrubber'
import { MediaGrid } from '@/views/gallery/library/media-grid'
import { findScrubberMarks } from '@/views/gallery/library/time-buckets'
import { useGalleryScroll } from '@/views/gallery/library/use-gallery-scroll'
import { Lightbox } from '@/views/gallery/lightbox/lightbox'
import type { CaptureKind, GalleryMedia } from '@/views/gallery/model/media'
import { useCaptureActions } from '@/views/capture/use-capture-actions'

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
  const albums = useAlbumStore(function (state) {
    return state.albums
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
            <Icon
              icon="lucide:clock"
              className="size-2.5"
              aria-hidden
            />
            {hint.daysLeft} 天后清理
          </span>
        )
      }
      return null
    }
    const label =
      hint.reason === 'days' ? '即将清理' : hint.reason === 'count' ? '超出数量' : '超出容量'
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-warning px-1 py-0.5 text-[10px] leading-none text-warning-foreground">
        <Icon
          icon="lucide:triangle-alert"
          className="size-2.5"
          aria-hidden
        />
        {label}
      </span>
    )
  }

  const { attachToAlbum, copySelected, detachFromAlbum, patchKeep, removeSelected, saveSelected } =
    useCaptureActions({
      scoped,
      selectedIds,
      onSelectedIds,
      onSelecting
    })

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
                    <option
                      key={album.id}
                      value={album.id}>
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

      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-y-auto px-2">
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
        <DateScrubber
          marks={marks}
          scrollRoot={scrollRoot}
          scrollFxRef={scrollFxRef}
        />
      </div>

      <Lightbox
        open={isLightboxOpen}
        medias={scoped}
        initialId={lightboxId}
        onOpenChange={onLightboxOpen}
      />

      {props.kind === 'recording' && scoped[0] ? (
        <p className="sr-only">
          {formatUsageBytes(
            scoped.reduce(function (sum, media) {
              return sum + (media.asset.size ?? 0)
            }, 0)
          )}
        </p>
      ) : null}
    </div>
  )
}

export { CapturePane }
export type { CapturePaneProps }
