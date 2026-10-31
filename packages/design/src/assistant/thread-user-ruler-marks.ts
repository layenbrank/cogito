const PREVIEW_MAX_CHARS = 280

interface UserMessageMark {
  id: string
  preview: string
  ordinal: number
}

interface ThreadMessageLike {
  readonly id: string
  readonly role: string
  readonly content: readonly { readonly type: string; readonly text?: string }[]
}

function truncatePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= PREVIEW_MAX_CHARS) return normalized
  return `${normalized.slice(0, PREVIEW_MAX_CHARS)}…`
}

function findUserMessagePreview(message: ThreadMessageLike): string {
  const parts = message.content
    .map(function (part) {
      return part.type === 'text' ? part.text ?? '' : ''
    })
    .join('')
    .trim()

  if (parts) return truncatePreview(parts)
  const hasAttachment = message.content.some(function (part) {
    return part.type === 'file' || part.type === 'image'
  })
  return hasAttachment ? '(attachment)' : '(empty message)'
}

function buildUserMarksDigest(messages: readonly ThreadMessageLike[]): string {
  let digest = ''
  for (const message of messages) {
    if (message.role !== 'user') continue
    digest += message.id
    digest += '\u0001'
    digest += findUserMessagePreview(message)
    digest += '\u0000'
  }
  return digest
}

function collectUserMessageMarks(messages: readonly ThreadMessageLike[]): UserMessageMark[] {
  const marks: UserMessageMark[] = []
  let ordinal = 0
  for (const message of messages) {
    if (message.role !== 'user') continue
    ordinal += 1
    marks.push({
      id: message.id,
      preview: findUserMessagePreview(message),
      ordinal
    })
  }
  return marks
}

/**
 * Layout offset of `element` inside `ancestor`, ignoring sticky visual pinning.
 * Stuck sticky nodes report a top-of-viewport rect, so scrollIntoView / rect math
 * treat the latest user message as already aligned and become a no-op (n=1).
 */
function findLayoutOffsetTop(element: HTMLElement, ancestor: HTMLElement): number | null {
  let top = 0
  let node: HTMLElement | null = element
  while (node && node !== ancestor) {
    top += node.offsetTop
    const offsetParent = node.offsetParent as HTMLElement | null
    if (!offsetParent) return null
    if (offsetParent === ancestor) return top
    if (!ancestor.contains(offsetParent)) return null
    node = offsetParent
  }
  return node === ancestor ? top : null
}

function findScrollTopNeutralizingSticky(viewport: HTMLElement, target: HTMLElement): number {
  const stickyNodes: HTMLElement[] = []
  let cursor: HTMLElement | null = target
  while (cursor && cursor !== viewport) {
    if (getComputedStyle(cursor).position === 'sticky') {
      stickyNodes.push(cursor)
      cursor.style.setProperty('position', 'relative')
    }
    cursor = cursor.parentElement
  }
  const top =
    target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
  for (const sticky of stickyNodes) {
    sticky.style.removeProperty('position')
  }
  return top
}

function scrollToUserMessage(
  viewport: HTMLElement,
  messageId: string,
  prefersReducedMotion: boolean | null
) {
  const target = viewport.querySelector<HTMLElement>(
    `[data-user-message-id="${CSS.escape(messageId)}"]`
  )
  if (!target) return

  const layoutTop = findLayoutOffsetTop(target, viewport)
  const nextTop = Math.max(
    0,
    layoutTop ?? findScrollTopNeutralizingSticky(viewport, target)
  )

  viewport.scrollTo({
    top: nextTop,
    behavior: prefersReducedMotion ? 'auto' : 'smooth'
  })
}

export {
  buildUserMarksDigest,
  collectUserMessageMarks,
  scrollToUserMessage,
  truncatePreview
}
export type { ThreadMessageLike, UserMessageMark }
