/**
 * 知识库检索：仅本地 FTS5（BM25；1–2 字中文走 LIKE）。
 *
 * 云端向量 / RRF 融合已下线；完整实现见分支 `archive/knowledge-rag`。
 * 模块名保留 hybrid-search，避免牵动过多 import；导出形状与原先列表侧兼容。
 */
import { searchDocs, type KnowledgeHit } from '@/lib/knowledge-ipc'

const CANDIDATE_LIMIT = 20

interface SearchHit extends KnowledgeHit {
  /** 名次权重（只用于排序展示，不可跨查询比较） */
  fused: number
  channels: ['local']
}

interface SearchResult {
  hits: SearchHit[]
  counts: { local: number; cloud: number }
}

interface SearchOptions {
  baseId?: string
  topK?: number
}

/** 本地命中 → 带 fused 的列表项（界面仍用 hits 形状） */
function toHits(local: KnowledgeHit[], topK: number): SearchHit[] {
  return local.slice(0, topK).map(function (hit, index) {
    return {
      ...hit,
      fused: 1 / (60 + index + 1),
      channels: ['local']
    }
  })
}

/** 跑一次本地检索 */
async function searchHybrid(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const topK = options.topK ?? 8
  const local = await searchDocs(query, options.baseId, CANDIDATE_LIMIT)
  return {
    hits: toHits(local, topK),
    counts: { local: local.length, cloud: 0 }
  }
}

export { searchHybrid }
export type { SearchHit as HybridHit, SearchOptions as HybridOptions, SearchResult as HybridResult }
