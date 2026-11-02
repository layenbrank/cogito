/**
 * 把 composer / 消息里的图片附件解析成 lightbox 可用的 {id, src, fileName}。
 *
 * File 附件走与缩略图同一份进程级 Object URL 缓存（`attachmentUrlCache`）：
 * 同一张图在缩略图和灯箱里是同一串 URL，打开灯箱不必重新解码，也就没有
 * 「先空一帧、再出现」的闪动。回收交给缓存的 LRU，不按组件卸载 revoke ——
 * 卸载与重挂之间没有渲染帧，revoke 掉再取回同一串就等于图裂了。
 */
import { useMemo } from 'react'
import type { Attachment } from '@assistant-ui/react'

import type { AttachmentLightboxMedia } from '../assistant/attachment-lightbox'
import { attachmentUrlCache } from './use-attachment-src'

function findContentImageSrc(attachment: Attachment): string | undefined {
  const parts = attachment.content
  if (!parts) return undefined
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (part.type === 'image' && typeof part.image === 'string' && part.image) {
      return part.image
    }
  }
  return undefined
}

function useAttachmentLightboxMedias(
  attachments: readonly Attachment[]
): readonly AttachmentLightboxMedia[] {
  return useMemo(
    function () {
      const medias: AttachmentLightboxMedia[] = []
      for (const attachment of attachments) {
        if (attachment.type !== 'image') continue
        const fileName = attachment.name || 'image'
        const contentSrc = findContentImageSrc(attachment)
        if (contentSrc) {
          medias.push({ id: attachment.id, src: contentSrc, fileName })
          continue
        }
        const file = attachment.file
        if (!file) continue
        medias.push({
          id: attachment.id,
          src: attachmentUrlCache.src(file),
          fileName
        })
      }
      return medias
    },
    [attachments]
  )
}

export { useAttachmentLightboxMedias }
