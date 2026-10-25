type LightboxMediaKind = 'image' | 'video'

/** 媒体预览通用条目（图库 / 看板附件等共用） */
interface LightboxMedia {
  id: string
  src: string
  fileName: string
  kind: LightboxMediaKind
  durationMs?: number
}

export type { LightboxMedia, LightboxMediaKind }
