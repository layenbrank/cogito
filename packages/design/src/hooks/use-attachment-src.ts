import { useAuiState } from '@assistant-ui/react'
import { useShallow } from 'zustand/react/shallow'

import { createObjectUrlCache } from './object-url-cache'

/**
 * 附件缩略图共用的 URL 缓存（进程级）。
 *
 * 走**缓存**而不是「每次 effect 新建 + 回收」：同一张图必须始终是同一串 URL。
 * 旧的写法只要 `file` 身份或组件挂载状态抖一下，就会先返回一帧 `undefined`、再赋值
 * 新 URL —— `<img>` 于是走一遍「撤掉 → 重新解码」，流式输出时每个 token 都可能重来
 * 一次，看起来就是缩略图一直在闪。缓存的生命周期见 `object-url-cache.ts`。
 */
export const attachmentUrlCache = createObjectUrlCache()

const useFileSrc = (file: File | undefined) => {
  return file ? attachmentUrlCache.src(file) : undefined
}

export const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== 'image') return {}
      if (s.attachment.file) return { file: s.attachment.file }
      const src = s.attachment.content?.filter((c) => c.type === 'image')[0]?.image
      if (!src) return {}
      return { src }
    })
  )

  return useFileSrc(file) ?? src
}
