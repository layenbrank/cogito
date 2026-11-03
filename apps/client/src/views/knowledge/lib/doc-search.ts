/**
 * 知识库检索：本地 FTS 默认；可选向量命中 + RRF 混合排序。
 */
import { searchDocs, type KnowledgeHit } from '@/lib/knowledge-ipc'
import { readEmbeddingConfig } from '@/views/knowledge/lib/embedding-config.ts'
import { reciprocalRankFusion } from '@/views/knowledge/lib/search-hybrid.ts'
import { searchVectors, type VectorHit } from '@/views/knowledge/lib/vector-store.ts'

const RESULT_LIMIT = 20

interface SearchOptions {
  baseId?: string
  topK?: number
  /** 是否尝试向量召回（仍受 embedding 开关约束） */
  includeVector?: boolean
}

interface HybridSearchResult {
  hits: KnowledgeHit[]
  channels: string[]
  vectorHits: number
}

function mergeWithRrf(
  ftsHits: KnowledgeHit[],
  vectorHits: VectorHit[],
  baseId: string | undefined,
  topK: number
): KnowledgeHit[] {
  const fused = reciprocalRankFusion([
    ftsHits.map(function (hit) {
      return { id: hit.docId, score: hit.score }
    }),
    vectorHits.map(function (hit) {
      return { id: hit.docId, score: hit.score }
    })
  ])

  const byId = new Map<string, KnowledgeHit>()
  for (const hit of ftsHits) {
    byId.set(hit.docId, { ...hit })
  }
  for (const vector of vectorHits) {
    const existing = byId.get(vector.docId)
    if (existing) {
      byId.set(vector.docId, {
        ...existing,
        mode: existing.mode.includes('vector') ? existing.mode : `${existing.mode}+vector`,
        snippet: existing.snippet || vector.snippet
      })
      continue
    }
    byId.set(vector.docId, {
      docId: vector.docId,
      baseId: baseId ?? '',
      title: vector.snippet.slice(0, 48) || vector.docId,
      relPath: vector.docId,
      snippet: vector.snippet,
      score: vector.score,
      mode: 'vector'
    })
  }

  return [...byId.values()]
    .map(function (hit) {
      return {
        ...hit,
        score: fused.get(hit.docId) ?? hit.score
      }
    })
    .sort(function (left, right) {
      return right.score - left.score
    })
    .slice(0, topK)
}

async function searchKnowledge(
  query: string,
  options: SearchOptions = {}
): Promise<KnowledgeHit[]> {
  const result = await searchKnowledgeHybrid(query, options)
  return result.hits
}

async function searchKnowledgeHybrid(
  query: string,
  options: SearchOptions = {}
): Promise<HybridSearchResult> {
  const topK = options.topK ?? RESULT_LIMIT
  const channels = ['fts']
  const ftsHits = await searchDocs(query, options.baseId, topK)

  let vectorHits: VectorHit[] = []
  const embedding = readEmbeddingConfig()
  if (options.includeVector !== false && embedding.enabled) {
    vectorHits = await searchVectors(query, Math.min(8, topK))
    if (vectorHits.length > 0) channels.push('vector')
  }

  const hits =
    vectorHits.length > 0
      ? mergeWithRrf(ftsHits, vectorHits, options.baseId, topK)
      : ftsHits

  return {
    hits,
    channels,
    vectorHits: vectorHits.length
  }
}

export { searchKnowledge, searchKnowledgeHybrid }
export type { SearchOptions, HybridSearchResult }
