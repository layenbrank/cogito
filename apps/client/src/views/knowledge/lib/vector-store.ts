/**
 * 向量库：默认 LanceDB（Rust）；可回退 JSON localStorage。
 *
 * ## 这一层为什么这么写
 *
 * 用户报的症状是「开了 embedding 就卡死、整个 App 消失」。根因在 Rust 侧
 * （并发 delete+add、无维度校验、无超时），但前端也在放大它：
 * 旧实现每个 invoke 都没有超时、失败只 `console.error`，于是一个挂住的 IPC
 * 会让 Promise 永不 settle —— 设置页转圈、搜索栏卡住，用户以为「整个程序死了」。
 *
 * 所以这里统一加三样东西：
 * 1. **每个请求都有 AbortController / 超时**（embedding 8s，IPC 12s）；
 * 2. **写路径串行 + 失败退避重试**（Lance 单表 delete+add 不能并发）；
 * 3. **可取消**（`cancelEmbeddingWork()`，切库/关开关时立刻停）。
 *
 * 失败不再抛出给调用方：搜索返回 `[]`（上层自动降级到 FTS），
 * 写入返回 `false` 并记一条可上报的 warn。
 */
import { invoke } from '@tauri-apps/api/core'

import {
  readEmbeddingConfig,
  type EmbeddingConfig
} from '@/views/knowledge/lib/embedding-config.ts'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'

const INDEX_KEY = 'knowledge.vector.index'
/** 查询 embedding 的超时：超过就降级到 FTS（用户等 8s 还能接受） */
const SEARCH_TIMEOUT_MS = 8_000
/** 写入单条的 embedding 超时 */
const UPSERT_TIMEOUT_MS = 15_000
/** IPC 侧超时：Rust 内部是 10s，这里留 2s 余量兜底 */
const IPC_TIMEOUT_MS = 12_000
/** 探测端点用的超时：只发 1 个 token，短超时才能快速给反馈 */
const PROBE_TIMEOUT_MS = 6_000
/** 单条写入的重试次数（含首次） */
const UPSERT_ATTEMPTS = 2
/** 失败退避（毫秒） */
const RETRY_BACKOFF_MS = [400, 1_200] as const
/**
 * 写并发上限：**固定 1**。
 * Lance 同一张表的 delete+add 并发会互相覆盖 manifest（旧实现默认 2，正是卡死主因之一）。
 */
const MAX_UPSERT_CONCURRENCY = 1

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

/** 取消标记：切库 / 关开关 / 用户点「停止」时置位，正在跑的批次会尽快退出。 */
let cancelEpoch = 0

function cancelEmbeddingWork(): void {
  cancelEpoch += 1
}

function isCancelled(epoch: number): boolean {
  return epoch !== cancelEpoch
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

/** 给任意 Promise 套一个超时（IPC 没有 AbortController）。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error(`${label} 超时（${ms}ms）`))
    }, ms)
    promise.then(
      function (value) {
        clearTimeout(timer)
        resolve(value)
      },
      function (error) {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

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

/**
 * 调一次 `/embeddings`。超时用 `AbortController` 真取消（不是只 race），
 * 否则一个挂住的请求会一直占着连接。
 */
async function fetchEmbedding(
  text: string,
  config: EmbeddingConfig,
  timeoutMs = SEARCH_TIMEOUT_MS
): Promise<number[]> {
  if (!config.endpoint.trim()) {
    throw new Error('embedding 端点未配置')
  }
  const url = config.endpoint.replace(/\/$/, '') + '/embeddings'
  const controller = new AbortController()
  const timer = setTimeout(function () {
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      signal: controller.signal,
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
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`embedding 请求超时（${timeoutMs}ms）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 探测端点是否可用（设置页「启用」前先跑这个）。
 * 成功返回维度 —— 同时也就把「模型换过、维度对不上」的问题提前暴露出来。
 */
async function probeEmbeddingEndpoint(config: EmbeddingConfig): Promise<{ dim: number }> {
  const embedding = await fetchEmbedding('probe', config, PROBE_TIMEOUT_MS)
  return { dim: embedding.length }
}

async function searchVectors(query: string, topK = 8): Promise<VectorHit[]> {
  const config = readEmbeddingConfig()
  if (!config.enabled) return []
  if (!query.trim()) return []
  try {
    const queryVec = await fetchEmbedding(query, config, SEARCH_TIMEOUT_MS)
    if (config.store === 'lancedb') {
      const root = findActiveRootPath()
      if (!root) return []
      const rows = await withTimeout(
        invoke<{ pageId: string; score: number }[]>('vector_search', {
          projectPath: root,
          queryEmbedding: queryVec,
          topK
        }),
        IPC_TIMEOUT_MS,
        '向量检索'
      )
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
    // 降级：让上层（search-hybrid）继续用 FTS 结果
    console.warn('[vector-store] search failed, fallback to FTS', error)
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
    const embedding = await fetchEmbedding(input.text, config, UPSERT_TIMEOUT_MS)
    if (config.store === 'lancedb') {
      const root = findActiveRootPath()
      if (!root) return false
      await withTimeout(
        invoke('vector_upsert', {
          projectPath: root,
          pageId: input.docId.replace(/\\/g, '/'),
          embedding
        }),
        IPC_TIMEOUT_MS,
        '写入向量'
      )
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
    console.warn('[vector-store] upsert failed', input.docId, error)
    return false
  }
}

/** 带退避重试的单条写入。 */
async function upsertWithRetry(item: { docId: string; text: string }): Promise<boolean> {
  for (let attempt = 0; attempt < UPSERT_ATTEMPTS; attempt += 1) {
    const ok = await upsertPageEmbedding(item)
    if (ok) return true
    if (attempt < UPSERT_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)])
    }
  }
  return false
}

/**
 * 批量 upsert。**串行**执行（`MAX_UPSERT_CONCURRENCY = 1`），
 * 每写完一条检查一次取消标记；返回成功条数，永不抛。
 */
async function upsertPageEmbeddings(
  items: { docId: string; text: string }[]
): Promise<number> {
  const config = readEmbeddingConfig()
  if (!config.enabled || items.length === 0) return 0
  const epoch = cancelEpoch
  const batchSize = Math.max(1, config.batchSize)
  let ok = 0
  let index = 0
  // 保留 concurrency 配置语义，但实际并发不超过 1
  const workers = Math.max(1, Math.min(MAX_UPSERT_CONCURRENCY, config.concurrency))
  async function worker(): Promise<void> {
    while (index < items.length) {
      if (isCancelled(epoch)) {
        console.info('[vector-store] 批量写入已取消')
        return
      }
      const current = index
      index += 1
      const item = items[current]
      if (!item) continue
      // batchSize 只用来切批，便于在批次边界让出事件循环
      if (current > 0 && current % batchSize === 0) {
        await sleep(0)
      }
      const success = await upsertWithRetry(item)
      if (success) ok += 1
    }
  }
  await Promise.all(
    Array.from({ length: workers }, function () {
      return worker()
    })
  )
  console.info(`[vector-store] 批量写入完成 ${ok}/${items.length}`)
  return ok
}

async function removePageEmbedding(docId: string): Promise<void> {
  const config = readEmbeddingConfig()
  if (config.store === 'lancedb') {
    const root = findActiveRootPath()
    if (!root) return
    try {
      await withTimeout(
        invoke('vector_delete', {
          projectPath: root,
          pageId: docId.replace(/\\/g, '/')
        }),
        IPC_TIMEOUT_MS,
        '删除向量'
      )
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
      return await withTimeout(
        invoke<number>('vector_count', { projectPath: root }),
        IPC_TIMEOUT_MS,
        '统计向量'
      )
    } catch (error) {
      console.warn('[vector-store] lance count failed', error)
      return 0
    }
  }
  return Object.keys(readIndex()).length
}

/**
 * 清空当前库的向量索引（设置页显式按钮，不在挂载时隐式做）。
 * LanceDB 侧删表；JSON 侧清 localStorage。
 */
async function clearVectorIndex(): Promise<void> {
  cancelEmbeddingWork()
  const config = readEmbeddingConfig()
  if (config.store === 'lancedb') {
    const root = findActiveRootPath()
    if (!root) return
    await withTimeout(
      invoke('vector_clear', { projectPath: root }),
      IPC_TIMEOUT_MS,
      '清空向量索引'
    )
    return
  }
  localStorage.removeItem(INDEX_KEY)
}

export {
  INDEX_KEY,
  MAX_UPSERT_CONCURRENCY,
  cancelEmbeddingWork,
  clearVectorIndex,
  countVectors,
  probeEmbeddingEndpoint,
  removePageEmbedding,
  searchVectors,
  upsertPageEmbedding,
  upsertPageEmbeddings
}
export type { VectorHit }
