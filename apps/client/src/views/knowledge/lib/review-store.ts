/**
 * 审阅队列（localStorage）。P0 起带 kind，为 P1 类型矩阵铺垫。
 */
const REVIEW_STORAGE_KEY = 'knowledge.review.items'

type ReviewItemStatus = 'pending' | 'approved' | 'rejected' | 'dismissed'
type ReviewItemKind =
  | 'confirm'
  | 'suggestion'
  | 'contradiction'
  | 'duplicate'
  | 'missing-page'

interface ReviewItem {
  id: string
  title: string
  prompt: string
  status: ReviewItemStatus
  kind: ReviewItemKind
  wikiPath?: string
  sourcePath?: string
}

function normalizeItem(raw: unknown): ReviewItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<ReviewItem>
  if (typeof item.id !== 'string' || typeof item.title !== 'string') return null
  return {
    id: item.id,
    title: item.title,
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
    status: (item.status as ReviewItemStatus) || 'pending',
    kind: (item.kind as ReviewItemKind) || 'confirm',
    wikiPath: typeof item.wikiPath === 'string' ? item.wikiPath : undefined,
    sourcePath: typeof item.sourcePath === 'string' ? item.sourcePath : undefined
  }
}

function readReviewItems(): ReviewItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(REVIEW_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeItem)
      .filter(function (item): item is ReviewItem {
        return item !== null
      })
  } catch (error) {
    console.warn('[knowledge/review] 读取失败', error)
    return []
  }
}

function writeReviewItems(items: ReviewItem[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(items))
  } catch (error) {
    console.warn('[knowledge/review] 写入失败', error)
  }
}

function patchReviewItem(id: string, patch: Partial<ReviewItem>): void {
  const items = readReviewItems().map(function (item) {
    if (item.id !== id) return item
    return { ...item, ...patch }
  })
  writeReviewItems(items)
}

function pushReviewItem(item: Omit<ReviewItem, 'id'> & { id?: string }): void {
  const id =
    item.id ??
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `review-${Date.now()}`)
  writeReviewItems([{ ...item, id, kind: item.kind || 'confirm' }, ...readReviewItems()].slice(0, 200))
}

export {
  REVIEW_STORAGE_KEY,
  patchReviewItem,
  pushReviewItem,
  readReviewItems,
  writeReviewItems
}
export type { ReviewItem, ReviewItemKind, ReviewItemStatus }
