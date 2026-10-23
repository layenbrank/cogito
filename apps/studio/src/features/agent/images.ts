import type { ChatImage, ChatRunMessage } from '@cogito/chat/ports'

import { canSeeImages } from './vision.ts'

/** 单张 data URL 上限。再大就会顶破端口 payload，不如发送前丢掉并说明 */
const MAX_IMAGE_CHARS = 700_000
const MAX_IMAGES = 4
/** 给正文和引用留余量，避免整包超过主进程的 1MB 上限 */
const PAYLOAD_BUDGET = 900_000

const NOTICE_BLIND = '当前模型看不到图片，缩略图会留在对话里，但不会把图片内容发给它'
const NOTICE_HUGE = '有图片超过大小限制，模型收不到这些图'

interface PreparedMessages {
  messages: ChatRunMessage[]
  notice: string | null
}

function stripImages(message: ChatRunMessage): ChatRunMessage {
  if (!message.images?.length) return message
  const { images: _images, ...rest } = message
  return rest
}

function applyImages(
  messages: readonly ChatRunMessage[],
  accepted: readonly { index: number; image: ChatImage }[]
): ChatRunMessage[] {
  const grouped = new Map<number, ChatImage[]>()
  for (const item of accepted) {
    const bucket = grouped.get(item.index) ?? []
    bucket.push(item.image)
    grouped.set(item.index, bucket)
  }

  return messages.map(function (message, index) {
    const images = grouped.get(index)
    if (!images?.length) return stripImages(message)
    // 收集时从新到旧，这里翻回用户添加的顺序
    return { ...stripImages(message), images: images.slice().reverse() }
  })
}

/**
 * 发送前把图片和路径引用拆开。
 *
 * 路径引用仍在 `attachments` 里。图片只在模型能看、且装得进 payload 时
 * 才留在消息上；否则剥掉并给出一句提示，缩略图仍在对话 UI 里。
 */
function prepareImages(messages: readonly ChatRunMessage[], model: string): PreparedMessages {
  const hasImage = messages.some(function (message) {
    return Boolean(message.images?.length)
  })
  if (!hasImage) return { messages: [...messages], notice: null }

  const stripped = messages.map(stripImages)
  if (!canSeeImages(model)) {
    return { messages: stripped, notice: NOTICE_BLIND }
  }

  const candidates: { index: number; image: ChatImage }[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const images = messages[index]?.images ?? []
    for (let imageIndex = images.length - 1; imageIndex >= 0; imageIndex -= 1) {
      const image = images[imageIndex]
      if (image) candidates.push({ index, image })
    }
  }

  const accepted: { index: number; image: ChatImage }[] = []
  let dropped = false
  for (const item of candidates) {
    if (item.image.data.length > MAX_IMAGE_CHARS || accepted.length >= MAX_IMAGES) {
      dropped = true
      continue
    }
    const trial = applyImages(stripped, [...accepted, item])
    if (JSON.stringify(trial).length > PAYLOAD_BUDGET) {
      dropped = true
      continue
    }
    accepted.push(item)
  }

  return {
    messages: applyImages(stripped, accepted),
    notice: dropped ? NOTICE_HUGE : null
  }
}

export { NOTICE_BLIND, NOTICE_HUGE, prepareImages }
