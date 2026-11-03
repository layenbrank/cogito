/**
 * 检索混合排序：FTS hits + 向量 + 简单 RRF；附带图片命中。
 */
import type { KnowledgeHit } from '@/lib/knowledge-ipc'
import { searchVectors } from '@/views/knowledge/lib/vector-store.ts'

interface ImageHit {
  docId: string
  alt: string
  src: string
  score: number
}

function reciprocalRankFusion(
  lists: { id: string; score: number }[][],
  k = 60
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach(function (item, index) {
      const prev = scores.get(item.id) ?? 0
      scores.set(item.id, prev + 1 / (k + index + 1) + item.score * 0.01)
    })
  }
  return scores
}

async function mergeHybridHits(input: {
  ftsHits: KnowledgeHit[]
  query: string
}): Promise<KnowledgeHit[]> {
  const vectorHits = await searchVectors(input.query, 12)
  const fused = reciprocalRankFusion([
    input.ftsHits.map(function (hit) {
      return { id: hit.docId || hit.relPath, score: hit.score ?? 0 }
    }),
    vectorHits.map(function (hit) {
      return { id: hit.docId, score: hit.score }
    })
  ])

  const byId = new Map<string, KnowledgeHit>()
  for (const hit of input.ftsHits) {
    byId.set(hit.docId || hit.relPath, hit)
  }
  for (const hit of vectorHits) {
    if (!byId.has(hit.docId)) {
      byId.set(hit.docId, {
        docId: hit.docId,
        relPath: hit.docId,
        title: hit.docId,
        snippet: hit.snippet,
        score: hit.score
      } as KnowledgeHit)
    }
  }

  return [...byId.values()].sort(function (a, b) {
    const left = fused.get(a.docId || a.relPath) ?? 0
    const right = fused.get(b.docId || b.relPath) ?? 0
    return right - left
  })
}

function findImageHitsFromMarkdown(
  pages: { relPath: string; content: string }[],
  query: string
): ImageHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: ImageHit[] = []
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g
  for (const page of pages) {
    let match: RegExpExecArray | null
    re.lastIndex = 0
    while ((match = re.exec(page.content))) {
      const alt = match[1] || ''
      const src = match[2] || ''
      const hay = `${alt} ${src}`.toLowerCase()
      if (!hay.includes(needle)) continue
      hits.push({
        docId: page.relPath,
        alt: alt || src,
        src,
        score: hay.startsWith(needle) ? 1 : 0.5
      })
    }
  }
  return hits.sort(function (a, b) {
    return b.score - a.score
  })
}

export { findImageHitsFromMarkdown, mergeHybridHits, reciprocalRankFusion }
export type { ImageHit }
