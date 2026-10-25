import type { LightboxMedia } from '@/components/media-lightbox'
import type { GalleryMedia } from '@/views/gallery/model/media'

function toLightboxMedia(media: GalleryMedia): LightboxMedia {
  return {
    id: media.asset.id,
    src: media.src,
    fileName: media.asset.fileName,
    kind: media.kind,
    durationMs: media.meta.durationMs
  }
}

function toLightboxMedias(medias: GalleryMedia[]): LightboxMedia[] {
  return medias.map(toLightboxMedia)
}

export { toLightboxMedia, toLightboxMedias }
