/**
 * 向量库前端壳：**不再把失败甩给调用方**。
 *
 * 这里锁的是用户报的症状对应的三条不变式：
 * 1. 写路径必须串行（Lance 同一张表 delete+add 会互踩）；
 * 2. 任何一次 IPC / 端点失败都不抛，搜索降级 FTS、写入返回 false；
 * 3. 批量写入能被 `cancelEmbeddingWork()` 中途停掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', function () {
  return { invoke }
})

vi.mock('@/stores/knowledge-base', function () {
  return {
    useKnowledgeBaseStore: {
      getState: function () {
        return { bases: [], activeBaseID: null }
      }
    }
  }
})

import {
  INDEX_KEY,
  MAX_UPSERT_CONCURRENCY,
  cancelEmbeddingWork,
  countVectors,
  probeEmbeddingEndpoint,
  searchVectors,
  upsertPageEmbedding,
  upsertPageEmbeddings
} from '@/views/knowledge/lib/vector-store.ts'
import { readEmbeddingConfig } from '@/views/knowledge/lib/embedding-config.ts'

const CONFIG_KEY = 'knowledge.embedding.config'

function useJsonStore(patch: Record<string, unknown> = {}): void {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      enabled: true,
      store: 'json',
      endpoint: 'http://embedding.local/v1',
      model: 'test-model',
      ...patch
    })
  )
}

function stubEmbedding(vector: number[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async function () {
      return {
        ok: true,
        json: async function () {
          return { data: [{ embedding: vector }] }
        }
      }
    })
  )
}

beforeEach(function () {
  localStorage.clear()
  invoke.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(function () {
    /* 失败路径本来就要 warn，静音避免刷屏 */
  })
  vi.spyOn(console, 'info').mockImplementation(function () {
    /* 同上 */
  })
})

afterEach(function () {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('vector-store', function () {
  it('写并发上限固定为 1（并发 delete+add 是卡死主因）', function () {
    expect(MAX_UPSERT_CONCURRENCY).toBe(1)
  })

  it('JSON 回退：写入后可检索到，按相似度排序', async function () {
    useJsonStore()
    stubEmbedding([1, 0, 0])

    await expect(upsertPageEmbedding({ docId: 'wiki/a.md', text: '甲' })).resolves.toBe(true)
    await expect(countVectors()).resolves.toBe(1)

    const hits = await searchVectors('甲', 5)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.docId).toBe('wiki/a.md')
    expect(hits[0]?.score).toBeCloseTo(1, 5)
  })

  it('端点不可达：搜索返回空数组（交给上层降级 FTS），写入返回 false', async function () {
    useJsonStore()
    vi.stubGlobal(
      'fetch',
      vi.fn(async function () {
        throw new Error('FetchError: <no response>')
      })
    )

    await expect(searchVectors('任意', 5)).resolves.toEqual([])
    await expect(upsertPageEmbedding({ docId: 'wiki/b.md', text: '乙' })).resolves.toBe(false)
    await expect(countVectors()).resolves.toBe(0)
  })

  it('开关未启用时不发请求、不写索引', async function () {
    useJsonStore({ enabled: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertPageEmbedding({ docId: 'wiki/c.md', text: '丙' })).resolves.toBe(false)
    await expect(searchVectors('丙', 5)).resolves.toEqual([])
    await expect(upsertPageEmbeddings([{ docId: 'wiki/c.md', text: '丙' }])).resolves.toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(INDEX_KEY)).toBeNull()
  })

  it('批量写入可被 cancelEmbeddingWork() 中途停掉', async function () {
    useJsonStore()
    stubEmbedding([1, 0, 0])

    const items = [
      { docId: 'wiki/1.md', text: '一' },
      { docId: 'wiki/2.md', text: '二' },
      { docId: 'wiki/3.md', text: '三' }
    ]
    const batch = upsertPageEmbeddings(items)
    // 立刻取消：worker 在每条之间检查取消标记，后续条目应被跳过
    cancelEmbeddingWork()

    const done = await batch
    expect(done).toBeLessThan(items.length)
  })
})

describe('probeEmbeddingEndpoint（设置页「启用」前的那一次探测）', function () {
  it('端点不可达：reject，调用方据此不落 enabled=true', async function () {
    useJsonStore()
    const config = readEmbeddingConfig()
    vi.stubGlobal(
      'fetch',
      vi.fn(async function () {
        throw new Error('FetchError: <no response>')
      })
    )

    await expect(probeEmbeddingEndpoint(config)).rejects.toThrow(/no response/)
  })

  it('HTTP 500：reject 并带上状态码，不吞错', async function () {
    useJsonStore()
    const config = readEmbeddingConfig()
    vi.stubGlobal(
      'fetch',
      vi.fn(async function () {
        return {
          ok: false,
          status: 500,
          json: async function () {
            return {}
          }
        }
      })
    )

    await expect(probeEmbeddingEndpoint(config)).rejects.toThrow('embedding HTTP 500')
  })

  it('探测通过：返回维度，设置页据此才启用', async function () {
    useJsonStore()
    const config = readEmbeddingConfig()
    stubEmbedding([0, 1, 0, 0])

    await expect(probeEmbeddingEndpoint(config)).resolves.toEqual({ dim: 4 })
  })
})
