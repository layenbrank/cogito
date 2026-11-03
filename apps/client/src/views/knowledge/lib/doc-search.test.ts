import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge-ipc', function () {
  return {
    searchDocs: vi.fn(async function () {
      return [
        {
          docId: 'a',
          baseId: 'b1',
          title: 'Alpha',
          relPath: 'wiki/a.md',
          snippet: 'fts',
          score: 1,
          mode: 'fts'
        }
      ]
    })
  }
})

vi.mock('@/views/knowledge/lib/vector-store.ts', function () {
  return {
    searchVectors: vi.fn(async function () {
      return [
        { docId: 'a', score: 0.8, snippet: 'vec-a' },
        { docId: 'c', score: 0.9, snippet: 'only-vector' }
      ]
    })
  }
})

vi.mock('@/views/knowledge/lib/embedding-config.ts', function () {
  return {
    readEmbeddingConfig: vi.fn(function () {
      return { enabled: true }
    })
  }
})

describe('searchKnowledgeHybrid', function () {
  beforeEach(function () {
    vi.resetModules()
  })

  it('merges fts and vector hits by docId', async function () {
    const { searchKnowledgeHybrid } = await import('@/views/knowledge/lib/doc-search.ts')
    const result = await searchKnowledgeHybrid('q', { baseId: 'b1', topK: 10 })
    expect(result.channels).toContain('fts')
    expect(result.channels).toContain('vector')
    expect(result.hits.some(function (hit) {
      return hit.docId === 'a' && hit.mode.includes('vector')
    })).toBe(true)
    expect(result.hits.some(function (hit) {
      return hit.docId === 'c' && hit.mode === 'vector'
    })).toBe(true)
  })
})
