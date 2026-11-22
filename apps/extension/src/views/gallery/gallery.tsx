import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'

import { database, type GalleryAssetRow } from '@/database/database.ts'
import { notify } from '@/features/shell/notice-state.ts'
import { invalidateGalleryMarkerThumbs } from '@/features/magnetic-tiles/gallery/preview-cache.ts'

type Leaf = 'root' | 'photos' | 'videos' | 'hidden'
type Tab = 'library' | 'collections'

interface GalleryItem extends GalleryAssetRow {
  src: string
}

function kindOf(file: File): GalleryAssetRow['kind'] | null {
  if (file.type.startsWith('image/')) return 'photo'
  if (file.type.startsWith('video/')) return 'video'
  return null
}

/** 双击图库磁贴进入的图库：导入本机图片或视频，按图库 / 精选集浏览。 */
export default function Gallery() {
  const [rows, updateRows] = useState<GalleryAssetRow[]>([])
  const [tab, updateTab] = useState<Tab>('library')
  const [leaf, updateLeaf] = useState<Leaf>('root')
  const [openID, updateOpenID] = useState<string | null>(null)

  async function reload(): Promise<void> {
    const next = await database.galleryAsset.orderBy('createdAt').reverse().toArray()
    updateRows(next)
  }

  useEffect(function () {
    void reload().catch(function (error) {
      console.error('[gallery] 读取失败', error)
    })
  }, [])

  const items = useMemo(
    function () {
      return rows.map(function (row) {
        return { ...row, src: URL.createObjectURL(row.blob) }
      })
    },
    [rows]
  )

  useEffect(
    function () {
      return function () {
        for (const item of items) URL.revokeObjectURL(item.src)
      }
    },
    [items]
  )

  const visible = items.filter(function (item) {
    return !item.hidden
  })
  const photos = visible.filter(function (item) {
    return item.kind === 'photo'
  })
  const videos = visible.filter(function (item) {
    return item.kind === 'video'
  })
  const hidden = items.filter(function (item) {
    return item.hidden
  })

  const listed =
    tab === 'collections' && leaf === 'photos'
      ? photos
      : tab === 'collections' && leaf === 'videos'
        ? videos
        : tab === 'collections' && leaf === 'hidden'
          ? hidden
          : visible

  const opened = items.find(function (item) {
    return item.id === openID
  })

  async function importFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return
    const now = Date.now()
    const writes: GalleryAssetRow[] = []
    for (const file of files) {
      const kind = kindOf(file)
      if (!kind) continue
      writes.push({
        id: crypto.randomUUID(),
        name: file.name,
        mime: file.type,
        kind,
        blob: file,
        hidden: false,
        createdAt: now
      })
    }
    if (!writes.length) {
      notify('没有可导入的图片或视频')
      return
    }
    await database.galleryAsset.bulkAdd(writes)
    invalidateGalleryMarkerThumbs()
    await reload()
    notify(`已导入 ${writes.length} 项`)
  }

  function pickFiles(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.multiple = true
    input.addEventListener('change', function () {
      void importFiles(input.files).catch(function (error) {
        console.error('[gallery] 导入失败', error)
        notify('导入失败')
      })
    })
    input.click()
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {tab === 'library' ? '图库' : leaf === 'photos' ? '照片' : leaf === 'videos' ? '视频' : leaf === 'hidden' ? '已隐藏' : '精选集'}
          </h1>
          <p className="text-sm text-muted-foreground">{listed.length} 个项目</p>
        </div>
        <Button type="button" onClick={pickFiles}>
          <Icon icon="lucide:download" aria-hidden />
          导入
        </Button>
      </header>

      {tab === 'collections' && leaf === 'root' ? (
        <div className="grid grid-cols-2 gap-3 px-4 pb-24">
          <CollectionTile label="照片" count={photos.length} onOpen={function () { updateLeaf('photos') }} />
          <CollectionTile label="视频" count={videos.length} onOpen={function () { updateLeaf('videos') }} />
          <CollectionTile label="已隐藏" count={hidden.length} onOpen={function () { updateLeaf('hidden') }} />
        </div>
      ) : listed.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">还没有媒体。导入图片或视频后会显示在这里。</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-1 overflow-y-auto overscroll-y-contain px-4 pb-24">
          {listed.map(function (item) {
            return (
              <button
                key={item.id}
                type="button"
                className="aspect-square overflow-hidden bg-muted"
                onClick={function () {
                  updateOpenID(item.id)
                }}>
                {item.kind === 'video' ? (
                  <video src={item.src} className="size-full object-cover" muted />
                ) : (
                  <img src={item.src} alt={item.name} className="size-full object-cover" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {tab === 'collections' && leaf !== 'root' ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute top-3 left-4 z-20"
          onClick={function () {
            updateLeaf('root')
          }}>
          <Icon icon="lucide:chevron-left" aria-hidden />
          精选集
        </Button>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
        <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-full border border-border/50 bg-card/90 p-1 shadow-lg">
          <Button
            type="button"
            variant="ghost"
            className={clsx('h-full rounded-full px-3.5', tab === 'library' && 'bg-primary/15')}
            onClick={function () {
              updateTab('library')
              updateLeaf('root')
            }}>
            图库
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={clsx('h-full rounded-full px-3.5', tab === 'collections' && 'bg-primary/15')}
            onClick={function () {
              updateTab('collections')
              updateLeaf('root')
            }}>
            精选集
          </Button>
        </div>
      </div>

      {opened ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6"
          onClick={function () {
            updateOpenID(null)
          }}>
          {opened.kind === 'video' ? (
            <video src={opened.src} className="max-h-full max-w-full" controls autoPlay />
          ) : (
            <img src={opened.src} alt={opened.name} className="max-h-full max-w-full object-contain" />
          )}
        </div>
      ) : null}
    </div>
  )
}

function CollectionTile(props: { label: string; count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex aspect-[4/3] flex-col items-start justify-end rounded-2xl bg-muted p-4 text-left"
      onClick={props.onOpen}>
      <span className="text-base font-medium">{props.label}</span>
      <span className="text-sm text-muted-foreground">{props.count} 个项目</span>
    </button>
  )
}
