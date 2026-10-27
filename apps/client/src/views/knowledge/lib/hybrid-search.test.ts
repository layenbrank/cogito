import { describe, expect, it } from 'vitest'

import { fuseHits, rankWeight, RRF_K } from '@/views/knowledge/lib/hybrid-search.ts'

function localHit(docId: string, title = docId) {
  return {
    docId,
    baseId: 'b1',
    title,
    relPath: `${docId}.md`,
    snippet: `${docId} 片段`,
    score: 1,
    mode: 'fts'
  }
}

function cloudHit(assetId: string, score: number, text = '云片段') {
  return { assetID: assetId, ordinal: 0, score, text }
}

describe('rankWeight', function () {
  it('名次越靠前权重越大，且相差一个名次就是 1/(k+n) 的差', function () {
    expect(rankWeight(1)).toBeCloseTo(1 / (RRF_K + 1))
    expect(rankWeight(1)).toBeGreaterThan(rankWeight(2))
  })
})

describe('fuseHits', function () {
  it('两路都命中的文档排在最前（RRF 相加）', function () {
    const hits = fuseHits({
      local: [localHit('d1'), localHit('d2')],
      cloud: [cloudHit('a2', 0.9)],
      findDocId: function (assetId) {
        return assetId === 'a2' ? 'd2' : null
      },
      topK: 5
    })

    expect(hits.map((hit) => hit.docId)).toEqual(['d2', 'd1'])
    expect(hits[0].channels).toEqual(['local', 'cloud'])
    expect(hits[0].fused).toBeCloseTo(rankWeight(2) + rankWeight(1))
  })

  it('只被云端命中的文档也进结果，但缺本地字段', function () {
    const hits = fuseHits({
      local: [],
      cloud: [cloudHit('a9', 0.5, '只有云那一路')],
      findDocId: function () {
        return 'd9'
      },
      topK: 5
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ docId: 'd9', mode: 'cloud', channels: ['cloud'] })
    expect(hits[0].snippet).toBe('只有云那一路')
  })

  it('对不上文档的云端命中被丢掉（可能是已删除的资产）', function () {
    const hits = fuseHits({
      local: [localHit('d1')],
      cloud: [cloudHit('gone', 0.99)],
      findDocId: function () {
        return null
      },
      topK: 5
    })

    expect(hits.map((hit) => hit.docId)).toEqual(['d1'])
  })

  it('同一文档被云端命中多块时只取分数最高的那块的权重', function () {
    const hits = fuseHits({
      local: [],
      cloud: [cloudHit('a1', 0.1), cloudHit('a1', 0.8), cloudHit('a2', 0.5)],
      findDocId: function (assetId) {
        return assetId === 'a1' ? 'd1' : 'd2'
      },
      topK: 5
    })

    // a1 的最高块排第一 → d1 拿第 1 名权重；不会因为命中三块就叠加三次
    expect(hits.map((hit) => hit.docId)).toEqual(['d1', 'd2'])
    expect(hits[0].fused).toBeCloseTo(rankWeight(1))
  })

  it('topK 截断在最外层', function () {
    const hits = fuseHits({
      local: [localHit('d1'), localHit('d2'), localHit('d3')],
      cloud: [],
      findDocId: function () {
        return null
      },
      topK: 2
    })

    expect(hits).toHaveLength(2)
  })
})
