import { TypeTile } from '@/views/gallery/collections/type-tile'
import type { GalleryMedia } from '@/views/gallery/model/media'

interface CollectionsProps {
  recents: GalleryMedia[]
  photos: GalleryMedia[]
  videos: GalleryMedia[]
  screenshots: GalleryMedia[]
  hidden: GalleryMedia[]
  vaultUnlocked: boolean
  onOpenRecents: () => void
  onOpenPhotos: () => void
  onOpenVideos: () => void
  onOpenScreenshots: () => void
  onOpenHidden: () => void
}

function Collections(props: CollectionsProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-4 pt-2 pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">精选集</h1>
        <p className="text-sm text-muted-foreground">按类型浏览，敏感内容进入已隐藏</p>
      </div>

      <section className="mb-6 space-y-2">
        <h2 className="px-0.5 text-base font-semibold">我的相簿</h2>
        <div className="grid grid-cols-2 gap-3">
          <TypeTile
            icon="lucide:images"
            label="最近项目"
            count={props.recents.length}
            covers={props.recents}
            onClick={props.onOpenRecents}
          />
          <TypeTile
            icon="lucide:image"
            label="照片"
            count={props.photos.length}
            covers={props.photos}
            onClick={props.onOpenPhotos}
          />
          <TypeTile
            icon="lucide:clapperboard"
            label="视频"
            count={props.videos.length}
            covers={props.videos}
            onClick={props.onOpenVideos}
          />
          <TypeTile
            icon="lucide:smartphone"
            label="截屏"
            count={props.screenshots.length}
            covers={props.screenshots}
            onClick={props.onOpenScreenshots}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-0.5 text-base font-semibold">更多项目</h2>
        <div className="grid grid-cols-2 gap-3">
          <TypeTile
            icon="lucide:eye-off"
            label="已隐藏"
            count={props.hidden.length}
            covers={props.vaultUnlocked ? props.hidden : []}
            locked={!props.vaultUnlocked}
            onClick={props.onOpenHidden}
          />
        </div>
      </section>
    </div>
  )
}

export { Collections }
export type { CollectionsProps }
