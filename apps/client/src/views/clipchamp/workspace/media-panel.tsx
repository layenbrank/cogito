import { ScrollArea } from '@i-thinking/design/components/scroll-area'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  AudioBody,
  MediaListBody,
  StickerBody,
  TextBody,
  TransitionBody
} from '@/views/clipchamp/workspace/media-panel-bodies.tsx'

const PANEL_TITLE = {
  media: '我的媒体',
  text: '文本',
  stickers: '贴纸',
  transitions: '转场',
  audio: '音频'
} as const

/** 素材面板外壳：标题 + 按当前分栏渲染对应正文 */
function MediaPanel() {
  const mediaPanel = useClipchampStore(function (s) {
    return s.mediaPanel
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center border-b border-border/80 px-3">
        <h2 className="text-sm font-medium tracking-tight">{PANEL_TITLE[mediaPanel]}</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {mediaPanel === 'media' ? <MediaListBody /> : null}
          {mediaPanel === 'text' ? <TextBody /> : null}
          {mediaPanel === 'stickers' ? <StickerBody /> : null}
          {mediaPanel === 'transitions' ? <TransitionBody /> : null}
          {mediaPanel === 'audio' ? <AudioBody /> : null}
        </div>
      </ScrollArea>
    </div>
  )
}

export { MediaPanel }
