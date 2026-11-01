import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge-ipc', function () {
  return {
    searchDocs: vi.fn(async function () {
      return [
        {
          docId: 'd1',
          baseId: 'b1',
          title: '一',
          relPath: 'a.md',
          snippet: '片段甲',
          score: 2,
          mode: 'fts'
        },
        {
          docId: 'd2',
          baseId: 'b1',
          title: '二',
          relPath: 'b.md',
          snippet: '片段乙',
          score: 1,
          mode: 'like'
        }
      ]
    })
  }
})

const { searchHybrid } = await import('@/views/knowledge/lib/hybrid-search.ts')
const { searchDocs } = await import('@/lib/knowledge-ipc')

describe('searchHybrid', function () {
  it('只走本地 searchDocs，并截断到 topK', async function () {
    const result = await searchHybrid('测试', { baseId: 'b1', topK: 1 })

    expect(searchDocs).toHaveBeenCalledWith('测试', 'b1', 20)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].docId).toBe('d1')
    expect(result.hits[0].channels).toEqual(['local'])
    expect(result.counts).toEqual({ local: 2, cloud: 0 })
  })
})
