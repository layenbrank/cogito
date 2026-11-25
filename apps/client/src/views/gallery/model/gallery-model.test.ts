import { describe, expect, it } from 'vitest'

import type { GalleryRow } from '@/views/gallery/model/asset'
import {
  expandStacks,
  findAlbumCounts,
  findDupCounts,
  findFacets,
  findSections,
  findStats,
  findViewRows,
  foldStacks,
  formatBytes,
  formatDuration,
  sampleTimelineMarks,
  sortRows
} from '@/views/gallery/model/derive'
import {
  createFilter,
  createMatchContext,
  matchesFilter,
  parseFilter,
  serializeFilter,
  toggleIn
} from '@/views/gallery/model/filter'

/**
 * 图库纯函数测试：筛选 / 排序 / 分组 / 成组 / 重复计数。
 *
 * 这些是「新图库能不能信任」的地基 —— 网格只负责画，判断全在这里。
 */

const DAY = 24 * 60 * 60 * 1000

function findRow(patch: Partial<GalleryRow> & { id: string }): GalleryRow {
  return {
    kind: 'image',
    name: `${patch.id}.jpg`,
    path: `C:/photos/${patch.id}.jpg`,
    mime: 'image/jpeg',
    capturedAt: Date.UTC(2026, 7, 10),
    dateSource: 'exif',
    rating: 0,
    flag: null,
    label: null,
    size: 1024,
    width: 4000,
    height: 3000,
    durationMs: null,
    stackID: null,
    dupGroup: null,
    missing: false,
    hidden: false,
    albumIDs: [],
    keywords: [],
    source: 'import',
    captureKind: null,
    isManaged: false,
    keep: false,
    mtimeMs: 1,
    probed: true,
    ...patch
  }
}

const CONTEXT = { dupCounts: new Map<string, number>() }

describe('sortRows / findSections', function () {
  it('按拍摄时间降序排序', function () {
    const rows = [
      findRow({ id: 'a', capturedAt: Date.UTC(2026, 0, 1) }),
      findRow({ id: 'b', capturedAt: Date.UTC(2026, 5, 1) })
    ]
    expect(
      sortRows(rows, 'capturedAt').map(function (row) {
        return row.id
      })
    ).toEqual(['b', 'a'])
  })

  it('按天分组：同一天归一段，顺序保持降序', function () {
    // 分区用**本地时间**（用户看到的是本地日期），所以这里也用本地构造
    const rows = [
      findRow({ id: 'a', capturedAt: new Date(2026, 7, 10, 8).getTime() }),
      findRow({ id: 'b', capturedAt: new Date(2026, 7, 10, 18).getTime() }),
      findRow({ id: 'c', capturedAt: new Date(2026, 7, 9, 12).getTime() })
    ]
    const sections = findSections(rows, 'day')
    expect(
      sections.map(function (section) {
        return section.key
      })
    ).toEqual(['2026-08-10', '2026-08-09'])
    expect(sections[0]?.rows.map(function (row) { return row.id })).toEqual(['b', 'a'])
  })

  it('按月分组只有一段', function () {
    const rows = [
      findRow({ id: 'a', capturedAt: Date.UTC(2026, 7, 10) }),
      findRow({ id: 'b', capturedAt: Date.UTC(2026, 7, 20) })
    ]
    expect(findSections(rows, 'month')).toHaveLength(1)
  })
})

describe('成组与重复', function () {
  it('foldStacks 每个 stackID 只留一张', function () {
    const rows = [
      findRow({ id: 'a', stackID: 's1' }),
      findRow({ id: 'b', stackID: 's1' }),
      findRow({ id: 'c' })
    ]
    expect(
      foldStacks(rows).map(function (row) {
        return row.id
      })
    ).toEqual(['a', 'c'])
  })

  it('expandStacks 把选中项扩展成整组', function () {
    const rows = [
      findRow({ id: 'a', stackID: 's1' }),
      findRow({ id: 'b', stackID: 's1' }),
      findRow({ id: 'c' })
    ]
    expect(expandStacks(rows, ['a']).sort()).toEqual(['a', 'b'])
  })

  it('findDupCounts 只对组内 >1 的行给出计数', function () {
    const rows = [
      findRow({ id: 'a', dupGroup: 'd1' }),
      findRow({ id: 'b', dupGroup: 'd1' }),
      findRow({ id: 'c', dupGroup: 'd2' })
    ]
    const counts = findDupCounts(rows)
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(2)
    expect(counts.get('c')).toBe(1)
  })
})

describe('筛选', function () {
  it('星级 / 类型 / 拒绝 组合命中', function () {
    const rows = [
      findRow({ id: 'a', rating: 4 }),
      findRow({ id: 'b', rating: 2, kind: 'video' }),
      findRow({ id: 'c', flag: 'rejected' })
    ]
    const filter = { ...createFilter(), ratings: [4], kinds: ['image' as const] }
    expect(
      rows.filter(function (row) {
        return matchesFilter(row, filter)
      }).map(function (row) {
        return row.id
      })
    ).toEqual(['a'])
  })

  it('默认排除隐藏项，显式打开才包含', function () {
    const rows = [findRow({ id: 'a', hidden: true })]
    expect(matchesFilter(rows[0], createFilter())).toBe(false)
    expect(matchesFilter(rows[0], { ...createFilter(), includeHidden: true })).toBe(true)
  })

  it('searchIDs 命中时按 id 集过滤', function () {
    const rows = [findRow({ id: 'a' }), findRow({ id: 'b' })]
    const filter = { ...createFilter(), searchIDs: ['b'] }
    const context = createMatchContext(filter)
    expect(
      rows.filter(function (row) {
        return matchesFilter(row, filter, context)
      }).map(function (row) {
        return row.id
      })
    ).toEqual(['b'])
  })

  it('关键词按行上的 keywords 命中', function () {
    const rows = [
      findRow({ id: 'a', keywords: [{ facet: 'people', value: '妈妈' }] }),
      findRow({ id: 'b' })
    ]
    const filter = { ...createFilter(), keywords: ['people:妈妈'] }
    const context = createMatchContext(filter)
    expect(
      rows.filter(function (row) {
        return matchesFilter(row, filter, context)
      }).map(function (row) {
        return row.id
      })
    ).toEqual(['a'])
  })

  it('年份筛选按本地年份区间，边界含首含尾', function () {
    const rows = [
      findRow({ id: 'a', capturedAt: new Date(2025, 0, 1).getTime() }),
      findRow({ id: 'b', capturedAt: new Date(2025, 11, 31, 23, 59).getTime() }),
      findRow({ id: 'c', capturedAt: new Date(2026, 0, 1).getTime() })
    ]
    const filter = { ...createFilter(), yearFrom: 2025, yearTo: 2025 }
    const context = createMatchContext(filter)
    expect(
      rows.filter(function (row) {
        return matchesFilter(row, filter, context)
      }).map(function (row) {
        return row.id
      })
    ).toEqual(['a', 'b'])
  })

  it('toggleIn 增删对称', function () {
    expect(toggleIn([1, 2], 3)).toEqual([1, 2, 3])
    expect(toggleIn([1, 2], 1)).toEqual([2])
  })

  it('筛选序列化可往返；版本不符时返回 null', function () {
    const filter = { ...createFilter(), minRating: 3, labels: ['red' as const] }
    const restored = parseFilter(serializeFilter(filter))
    expect(restored?.minRating).toBe(3)
    expect(restored?.labels).toEqual(['red'])
    expect(restored?.searchIDs).toBeNull()
    expect(parseFilter('{"v":99}')).toBeNull()
    expect(parseFilter('not json')).toBeNull()
  })
})

describe('findViewRows', function () {
  it('待筛视图排除已拒绝与已评级', function () {
    const rows = [
      findRow({ id: 'a' }),
      findRow({ id: 'b', rating: 3 }),
      findRow({ id: 'c', flag: 'rejected' })
    ]
    const visible = findViewRows(rows, 'culling', createFilter(), CONTEXT, 'capturedAt', false)
    expect(
      visible.map(function (row) {
        return row.id
      })
    ).toEqual(['a'])
  })

  it('4★ 视图按星级过滤', function () {
    const rows = [findRow({ id: 'a', rating: 4 }), findRow({ id: 'b', rating: 3 })]
    expect(findViewRows(rows, 'rated4', createFilter(), CONTEXT, 'capturedAt', false)).toHaveLength(1)
  })
})

describe('统计与格式化', function () {
  it('findStats 统计待筛/拒绝/失效', function () {
    const rows = [
      findRow({ id: 'a' }),
      findRow({ id: 'b', flag: 'rejected' }),
      findRow({ id: 'c', missing: true })
    ]
    const stats = findStats(rows, rows)
    expect(stats.unrated).toBe(2)
    expect(stats.rejected).toBe(1)
    expect(stats.missing).toBe(1)
  })

  it('formatBytes / formatDuration', function () {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(90_000)).toBe('1:30')
  })

  it('rated4 视图按拍摄时间倒序', function () {
    const rows = [
      findRow({ id: 'old', rating: 4, capturedAt: Date.now() - 40 * DAY }),
      findRow({ id: 'new', rating: 4, capturedAt: Date.now() })
    ]
    expect(
      findViewRows(rows, 'rated4', createFilter(), CONTEXT, 'capturedAt', false).map(
        function (row) {
          return row.id
        }
      )
    ).toEqual(['new', 'old'])
  })
})

describe('刻度条抽样', function () {
  const marks = Array.from({ length: 100 }, function (_, index) {
    return { key: `d${String(index)}`, label: `第 ${String(index)} 天`, top: index * 100 }
  })

  it('少于上限时原样返回', function () {
    const few = marks.slice(0, 5)
    expect(sampleTimelineMarks(few, 40)).toEqual(few)
  })

  it('超过上限时等距抽样并保留最后一个', function () {
    const sampled = sampleTimelineMarks(marks, 10)
    expect(sampled.length).toBeLessThanOrEqual(11)
    expect(sampled[sampled.length - 1]?.key).toBe('d99')
    // 额外的 top 字段不能丢（刻度条按比例定位要用）
    expect(sampled[1]?.top).toBeTypeOf('number')
  })

  it('上限小于 2 时不做抽样', function () {
    expect(sampleTimelineMarks(marks, 1)).toEqual(marks)
  })
})

describe('facet 与相簿计数（从 catalog 派生）', function () {
  const rows = [
    findRow({
      id: 'a',
      rating: 4,
      label: 'red',
      albumIDs: ['al1'],
      keywords: [{ facet: 'people', value: '妈妈' }],
      capturedAt: new Date(2025, 5, 1).getTime()
    }),
    findRow({ id: 'b', rating: 0, kind: 'video', albumIDs: ['al1', 'al2'] }),
    findRow({ id: 'c', flag: 'rejected', capturedAt: new Date(2026, 1, 1).getTime() })
  ]

  it('scalar 维度按值计数', function () {
    const facets = findFacets(rows)
    expect(facets.total).toBe(3)
    expect(facets.ratings).toEqual(
      expect.arrayContaining([
        { value: '4', count: 1 },
        { value: '0', count: 2 }
      ])
    )
    expect(facets.labels).toEqual([{ value: 'red', count: 1 }])
    expect(facets.flags).toEqual([{ value: 'rejected', count: 1 }])
    expect(facets.kinds).toEqual(
      expect.arrayContaining([
        { value: 'image', count: 2 },
        { value: 'video', count: 1 }
      ])
    )
  })

  it('年份按本地年份分桶', function () {
    const facets = findFacets(rows)
    expect(facets.years).toEqual(
      expect.arrayContaining([
        { value: '2025', count: 1 },
        { value: '2026', count: 2 }
      ])
    )
  })

  it('相簿与关键词计数', function () {
    const facets = findFacets(rows)
    expect(facets.albums).toEqual(
      expect.arrayContaining([
        { value: 'al1', count: 2 },
        { value: 'al2', count: 1 }
      ])
    )
    expect(facets.keywords).toEqual([{ value: 'people:妈妈', count: 1 }])

    const counts = findAlbumCounts(rows)
    expect(counts).toEqual([
      { albumID: 'al1', count: 2 },
      { albumID: 'al2', count: 1 }
    ])
  })
})
