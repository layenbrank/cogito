/**
 * 向量库：默认 LanceDB（Rust）；可回退 JSON localStorage。
 */
import { invoke } from '@tauri-apps/api/core'

import {
  readEmbeddingConfig,
  type EmbeddingConfig
} from '@/views/knowledge/lib/embedding-config.ts'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'

const INDEX_KEY = 'knowledge.vector.index'

interface VectorHit {
  docId: string
  score: number
  snippet: string
}

interface VectorRecord {
  docId: string
  snippet: string
  embedding: number[]
  updatedAt: number
}

type VectorIndex = Record<string, VectorRecord>

function findActiveRootPath(): string | null {
  const state = useKnowledgeBaseStore.getState()
  const base = state.bases.find(function (item) {
    return item.id === state.activeBaseID
  })
  return base?.rootPath ?? null
}

function readIndex(): VectorIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as VectorIndex
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[vector-store] read index failed', error)
    return {}
  }
}

function writeIndex(index: VectorIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch (error) {
    console.warn('[vector-store] write index failed', error)
  }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return 0
  let dot = 0
  let left = 0
  let right = 0
  for (let i = 0; i < len; i += 1) {
    dot += a[i]! * b[i]!
    left += a[i]! * a[i]!
    right += b[i]! * b[i]!
  }
  const denom = Math.sqrt(left) * Math.sqrt(right)
  return denom === 0 ? 0 : dot / denom
}

async function fetchEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
  if (!config.endpoint.trim()) {
    throw new Error('embedding endpoint 未配置')
  }
  const url = config.endpoint.replace(/\/$/, '') + '/embeddings'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      input: text.slice(0, config.maxChunkChars)
    })
  })
  if (!response.ok) {
    throw new Error(`embedding HTTP ${response.status}`)
  }
  const json = (await response.json()) as {
    data?: { embedding?: number[] }[]
  }
  const embedding = json.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('embedding 响应缺少向量')
  }
  return embedding
}

async function searchVectors(query: string, topK = 8): Promise<VectorHit[]> {
  const config = readEmbeddingConfig()
  if (!config.enabled) return []
  if (!query.trim()) return []
  try {
    const queryVec = await fetchEmbedding(query, config)
    if (config.store === 'lancedb') {
      const root = findActiveRootPath()
      if (!root) return []
      const rows = await invoke<{ pageId: string; score: number }[]>('vector_search', {
        projectPath: root,
        queryEmbedding: queryVec,
        topK
      })
      return rows.map(function (row) {
        return {
          docId: row.pageId,
          score: row.score,
          snippet: row.pageId
        }
      })
    }
    const index = readIndex()
    const scored: VectorHit[] = []
    for (const record of Object.values(index)) {
      scored.push({
        docId: record.docId,
        score: cosine(queryVec, record.embedding),
        snippet: record.snippet
      })
    }
    return scored
      .sort(function (a, b) {
        return b.score - a.score
      })
      .slice(0, topK)
  } catch (error) {
    console.error('[vector-store] search failed', error)
    return []
  }
}

async function upsertPageEmbedding(input: {
  docId: string
  text: string
}): Promise<boolean> {
  const config = readEmbeddingConfig()
  if (!config.enabled) return false
  try {
    const embedding = await fetchEmbedding(input.text, config)
    if (config.store === 'lancedb') {
      const root = findActiveRootPath()
      if (!root) return false
      await invoke('vector_upsert', {
        projectPath: root,
        pageId: input.docId.replace(/\\/g, '/'),
        embedding
      })
      return true
    }
    const index = readIndex()
    index[input.docId] = {
      docId: input.docId,
      snippet: input.text.slice(0, 180),
      embedding,
      updatedAt: Date.now()
    }
    writeIndex(index)
    return true
  } catch (error) {
    console.error('[vector-store] upsert failed', error)
    return false
  }
}

/** 按 embedding.concurrency 限流批量 upsert（batchSize 仅作切片上限提示）。 */
async function upsertPageEmbeddings(
  items: { docId: string; text: string }[]
): Promise<number> {
  const config = readEmbeddingConfig()
  if (!config.enabled || items.length === 0) return 0
  const concurrency = Math.max(1, config.concurrency)
  const batchSize = Math.max(1, config.batchSize)
  let ok = 0
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const wave = items.slice(offset, offset + batchSize)
    let cursor = 0
    async function worker(): Promise<void> {
      while (cursor < wave.length) {
        const index = cursor
        cursor += 1
        const item = wave[index]
        if (!item) continue
        const success = await upsertPageEmbedding(item)
        if (success) ok += 1
      }
    }
    const workers = Array.from(
      { length: Math.min(concurrency, wave.length) },
      function () {
        return worker()
      }
    )
    const settled = await Promise.allSettled(workers)
    for (const result of settled) {
      if (result.status === 'rejected') {
        console.error('[vector-store] batch worker failed', result.reason)
      }
    }
  }
  return ok
}

async function removePageEmbedding(docId: string): Promise<void> {
  const config = readEmbeddingConfig()
  if (config.store === 'lancedb') {
    const root = findActiveRootPath()
    if (!root) return
    try {
      await invoke('vector_delete', {
        projectPath: root,
        pageId: docId.replace(/\\/g, '/')
      })
    } catch (error) {
      console.warn('[vector-store] lance delete failed', error)
    }
    return
  }
  const index = readIndex()
  if (!(docId in index)) return
  delete index[docId]
  writeIndex(index)
}

async function countVectors(): Promise<number> {
  const config = readEmbeddingConfig()
  if (config.store === 'lancedb') {
    const root = findActiveRootPath()
    if (!root) return 0
    try {
      return await invoke<number>('vector_count', { projectPath: root })
    } catch (error) {
      console.warn('[vector-store] lance count failed', error)
      return 0
    }
  }
  return Object.keys(readIndex()).length
}

export {
  INDEX_KEY,
  countVectors,
  removePageEmbedding,
  searchVectors,
  upsertPageEmbedding,
  upsertPageEmbeddings
}
export type { VectorHit }
