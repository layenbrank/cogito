/**
 * 把 composer / message 里的图片附件解析成 lightbox 可用的 {id,src,fileName}。
 * File 附件按身份复用 Object URL，仅在附件消失或卸载时回收。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment } from '@assistant-ui/react'

import type { AttachmentLightboxMedia } from '../assistant/attachment-lightbox'

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

function findFileKey(attachment: Attachment): string | null {
  const file = attachment.file
  if (!file) return null
  return `${attachment.id}|${file.name}|${file.size}|${file.lastModified}`
}

function useAttachmentLightboxMedias(
  attachments: readonly Attachment[]
): readonly AttachmentLightboxMedia[] {
  const imageAttachments = useMemo(
    function () {
      return attachments.filter(function (attachment) {
        return attachment.type === 'image'
      })
    },
    [attachments]
  )

  const fingerprint = useMemo(
    function () {
      return imageAttachments
        .map(function (attachment) {
          const contentSrc = findContentImageSrc(attachment) ?? ''
          const fileKey = findFileKey(attachment) ?? ''
          return `${attachment.id}|${attachment.name}|${contentSrc}|${fileKey}`
        })
        .join('\n')
    },
    [imageAttachments]
  )

  const urlByKeyRef = useRef(new Map<string, string>())
  const [medias, updateMedias] = useState<readonly AttachmentLightboxMedia[]>([])

  useEffect(
    function () {
      const nextKeys = new Set<string>()
      const next: AttachmentLightboxMedia[] = []

      for (let i = 0; i < imageAttachments.length; i += 1) {
        const attachment = imageAttachments[i]
        const contentSrc = findContentImageSrc(attachment)
        const fileName = attachment.name || 'image'

        if (contentSrc) {
          next.push({ id: attachment.id, src: contentSrc, fileName })
          continue
        }

        const fileKey = findFileKey(attachment)
        if (!fileKey || !attachment.file) continue

        nextKeys.add(fileKey)
        let src = urlByKeyRef.current.get(fileKey)
        if (!src) {
          src = URL.createObjectURL(attachment.file)
          urlByKeyRef.current.set(fileKey, src)
        }
        next.push({ id: attachment.id, src, fileName })
      }

      for (const [key, src] of urlByKeyRef.current) {
        if (nextKeys.has(key)) continue
        URL.revokeObjectURL(src)
        urlByKeyRef.current.delete(key)
      }

      updateMedias(next)
    },
    // fingerprint 覆盖 id/name/内容/file 身份变化
    // eslint-disable-next-line react-hooks/exhaustive-deps -- imageAttachments 已由 fingerprint 表征
    [fingerprint]
  )

  useEffect(function () {
    const urls = urlByKeyRef.current
    return function () {
      for (const src of urls.values()) {
        URL.revokeObjectURL(src)
      }
      urls.clear()
    }
  }, [])

  return medias
}

export { useAttachmentLightboxMedias }
