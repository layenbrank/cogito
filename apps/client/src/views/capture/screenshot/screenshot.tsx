import { useOutletContext } from 'react-router-dom'

import { CapturePane } from '@/views/capture/capture-pane'
import type { GalleryMedia } from '@/views/gallery/model/media'

interface CaptureOutletContext {
  albumID: string | null
  medias: GalleryMedia[]
}

function CaptureScreenshot() {
  const context = useOutletContext<CaptureOutletContext>()
  return (
    <CapturePane
      kind="screenshot"
      medias={context.medias}
      albumID={context.albumID}
      emptyHint="还没有截屏。用快捷键或磁贴截一张吧。"
    />
  )
}

export default CaptureScreenshot
