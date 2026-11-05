/**
 * 队列 drain 后清扫 Review：规则自动 resolve + 可选 ACP 摘要。
 */
import {
  readReviewItems,
  writeReviewItems,
  type ReviewItem
} from '@/views/knowledge/lib/review-store.ts'

function sweepReviewsByRules(): { resolved: number; remaining: ReviewItem[] } {
  const items = readReviewItems()
  let resolved = 0
  const remaining = items.map(function (item) {
    if (item.status !== 'pending') return item
    // 重复类：标题过短或与已通过项撞名 → dismiss
    if (item.kind === 'duplicate') {
      resolved += 1
      return { ...item, status: 'dismissed' as const }
    }
    // suggestion 且无 wikiPath：保留人工
    if (item.kind === 'suggestion' && item.wikiPath && /过短|truncat/i.test(item.prompt)) {
      resolved += 1
      return { ...item, status: 'approved' as const }
    }
    return item
  })
  writeReviewItems(remaining)
  return { resolved, remaining }
}

function sweepReviewsOnDrain(): number {
  try {
    const result = sweepReviewsByRules()
    if (result.resolved > 0) {
      console.info('[sweep-reviews] resolved', result.resolved)
    }
    return result.resolved
  } catch (error) {
    console.error('[sweep-reviews] failed', error)
    return 0
  }
}

export { sweepReviewsByRules, sweepReviewsOnDrain }
