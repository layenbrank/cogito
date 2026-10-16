import { ScrollArea } from '@i-thinking/design/components/scroll-area'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  AudioBody,
  MediaListBody,
  StickerBody,
  TextBody,
  TransitionBody
} from '@/views/clipchamp/workspace/media-surface-bodies.tsx'

const SURFACE_TITLE = {
  media: '我的媒体',
  text: '文本',
  stickers: '贴纸',
  transitions: '转场',
  audio: '音频'
} as const

/** 素材面板外壳：标题 + 按当前分栏渲染对应正文 */
function MediaSurface() {
  const mediaSurface = useClipchampStore(function (s) {
    return s.mediaSurface
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center border-b border-border/80 px-3">
        <h2 className="text-sm font-medium tracking-tight">{SURFACE_TITLE[mediaSurface]}</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {mediaSurface === 'media' ? <MediaListBody /> : null}
          {mediaSurface === 'text' ? <TextBody /> : null}
          {mediaSurface === 'stickers' ? <StickerBody /> : null}
          {mediaSurface === 'transitions' ? <TransitionBody /> : null}
          {mediaSurface === 'audio' ? <AudioBody /> : null}
        </div>
      </ScrollArea>
    </div>
  )
}

export { MediaSurface }
