/**
 * 调研主题与检索词（localStorage）。
 */
const RESEARCH_STORAGE_KEY = 'knowledge.research.items'

type ResearchItemStatus = 'draft' | 'queued' | 'done'

interface ResearchItem {
  id: string
  topic: string
  queries: string[]
  status: ResearchItemStatus
  resultsPath?: string
}

function readResearchItems(): ResearchItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RESEARCH_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(function (item): item is ResearchItem {
      return item && typeof item === 'object' && typeof (item as ResearchItem).id === 'string'
    })
  } catch (error) {
    console.warn('[knowledge/research] 读取失败', error)
    return []
  }
}

function writeResearchItems(items: ResearchItem[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(items))
  } catch (error) {
    console.warn('[knowledge/research] 写入失败', error)
  }
}

function appendResearchItem(topic: string, queries: string[]): ResearchItem {
  const item: ResearchItem = {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `research-${Date.now()}`,
    topic: topic.trim(),
    queries: queries.map(function (q) {
      return q.trim()
    }).filter(Boolean),
    status: 'draft'
  }
  const items = [...readResearchItems(), item]
  writeResearchItems(items)
  return item
}

function updateResearchItem(id: string, patch: Partial<ResearchItem>): ResearchItem | null {
  const items = readResearchItems()
  let updated: ResearchItem | null = null
  const next = items.map(function (item) {
    if (item.id !== id) return item
    updated = { ...item, ...patch }
    return updated
  })
  if (!updated) return null
  writeResearchItems(next)
  return updated
}

export {
  RESEARCH_STORAGE_KEY,
  appendResearchItem,
  readResearchItems,
  updateResearchItem,
  writeResearchItems
}
export type { ResearchItem, ResearchItemStatus }
