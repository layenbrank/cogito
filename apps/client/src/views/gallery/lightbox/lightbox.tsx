import { MediaLightbox } from '@/components/media-lightbox'
import { toLightboxMedias } from '@/views/gallery/lightbox/adapt'
import type { GalleryMedia } from '@/views/gallery/model/media'

interface LightboxProps {
  open: boolean
  medias: GalleryMedia[]
  initialId: string | null
  onOpenChange: (open: boolean) => void
}

/** 图库入口：GalleryMedia → 公共 MediaLightbox */
function Lightbox(props: LightboxProps) {
  return (
    <MediaLightbox
      open={props.open}
      medias={toLightboxMedias(props.medias)}
      initialId={props.initialId}
      onOpenChange={props.onOpenChange}
    />
  )
}

export { Lightbox }
export type { LightboxProps }
