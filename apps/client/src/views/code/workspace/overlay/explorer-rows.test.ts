import { describe, expect, it } from 'vitest'

import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import {
  EMPTY_ROW_SUFFIX,
  computeRowWindow,
  findExplorerRowIndex,
  flattenExplorerRows
} from '@/views/code/workspace/overlay/explorer-rows.ts'

function makeFile(key: string, title: string = key): FileTreeNode {
  return { title, key, isLeaf: true }
}

function makeDir(key: string, children?: FileTreeNode[], extra?: Partial<FileTreeNode>): FileTreeNode {
  return { title: key, key, isDirectory: true, ...extra, children }
}

/** 0:: → a(含 one.ts) / b(含 c) / empty(已加载但空) */
function makeTree(): FileTreeNode[] {
  return [
    makeDir('0::', [
      makeDir('0::a', [makeFile('0::a/one.ts')], { isLoaded: true }),
      makeDir('0::b', [makeDir('0::b/c', [makeFile('0::b/c/two.ts')], { isLoaded: true })], {
        isLoaded: true
      }),
      makeDir('0::empty', [], { isLoaded: true })
    ])
  ]
}

describe('flattenExplorerRows', function () {
  it('全折叠时只有根这一行', function () {
    const rows = flattenExplorerRows(makeTree(), new Set())
    expect(rows.map(function (row) {
      return [row.nodeKey, row.depth, row.kind]
    })).toEqual([['0::', 0, 'directory']])
  })

  it('按展开态铺平：顺序、深度、种类都对', function () {
    const rows = flattenExplorerRows(makeTree(), new Set(['0::', '0::a', '0::b', '0::b/c']))
    expect(rows.map(function (row) {
      return row.nodeKey
    })).toEqual(['0::', '0::a', '0::a/one.ts', '0::b', '0::b/c', '0::b/c/two.ts', '0::empty'])
    expect(rows.map(function (row) {
      return row.depth
    })).toEqual([0, 1, 2, 1, 2, 3, 1])
    expect(rows.map(function (row) {
      return row.kind
    })).toEqual(['directory', 'directory', 'file', 'directory', 'directory', 'file', 'directory'])
  })

  it('展开的空目录补一行空提示，折叠的不补', function () {
    const expanded = flattenExplorerRows(makeTree(), new Set(['0::', '0::empty']))
    const emptyRow = expanded[expanded.length - 1]
    expect(emptyRow.kind).toBe('empty')
    expect(emptyRow.key).toBe(`0::empty${EMPTY_ROW_SUFFIX}`)
    expect(emptyRow.depth).toBe(2)

    const collapsed = flattenExplorerRows(makeTree(), new Set(['0::']))
    expect(collapsed.some(function (row) {
      return row.kind === 'empty'
    })).toBe(false)
  })

  it('未加载的目录（children 缺失）不补空提示，等它读完再说', function () {
    const tree = [makeDir('0::', [makeDir('0::pending')], { isLoaded: true })]
    const rows = flattenExplorerRows(tree, new Set(['0::', '0::pending']))
    expect(rows.map(function (row) {
      return row.kind
    })).toEqual(['directory', 'directory'])
  })

  it('「显示更多」哨兵排在那一层末尾，且不展开', function () {
    const tree = [
      makeDir('0::', [
        makeDir('0::a', [makeFile('0::a/one.ts'), { title: '显示更多（还有 3 项）', key: '0::a::__more__', isLoadMore: true }], {
          isLoaded: true
        })
      ])
    ]
    const rows = flattenExplorerRows(tree, new Set(['0::', '0::a']))
    const last = rows[rows.length - 1]
    expect(last.kind).toBe('loadMore')
    expect(last.depth).toBe(2)
    expect(rows.filter(function (row) {
      return row.kind === 'loadMore'
    })).toHaveLength(1)
  })
})

describe('computeRowWindow', function () {
  const rowHeight = 28

  it('顶部：从 0 开始，上下占位撑起总高度', function () {
    const win = computeRowWindow({ total: 1000, scrollTop: 0, viewportHeight: 560, rowHeight })
    expect(win.start).toBe(0)
    expect(win.end).toBe(20)
    expect(win.topHeight).toBe(0)
    expect(win.bottomHeight).toBe((1000 - 20) * rowHeight)
  })

  it('中部：start 跟随 scrollTop，上下占位相加等于剩余行', function () {
    const win = computeRowWindow({ total: 1000, scrollTop: 2800, viewportHeight: 560, rowHeight })
    expect(win.start).toBe(100)
    expect(win.end).toBe(120)
    expect(win.topHeight).toBe(100 * rowHeight)
    expect(win.topHeight + (win.end - win.start) * rowHeight + win.bottomHeight).toBe(1000 * rowHeight)
  })

  it('底部与越界：窗口不越出 [0, total]', function () {
    const bottom = computeRowWindow({ total: 30, scrollTop: 10000, viewportHeight: 560, rowHeight })
    expect(bottom.start).toBe(29)
    expect(bottom.end).toBe(30)
    expect(bottom.bottomHeight).toBe(0)

    const negative = computeRowWindow({ total: 30, scrollTop: -50, viewportHeight: 560, rowHeight })
    expect(negative.start).toBe(0)
  })

  it('overscan 向两侧扩展', function () {
    const win = computeRowWindow({ total: 1000, scrollTop: 2800, viewportHeight: 560, rowHeight, overscan: 6 })
    expect(win.start).toBe(94)
    expect(win.end).toBe(126)
  })

  it('活动行在窗口外时把窗口拉过去', function () {
    const below = computeRowWindow({ total: 1000, scrollTop: 0, viewportHeight: 560, rowHeight, activeIndex: 500 })
    expect(below.end).toBe(501)
    const above = computeRowWindow({ total: 1000, scrollTop: 28000, viewportHeight: 560, rowHeight, activeIndex: 3 })
    expect(above.start).toBe(3)
  })

  it('空列表返回空窗口', function () {
    expect(computeRowWindow({ total: 0, scrollTop: 0, viewportHeight: 560, rowHeight })).toEqual({
      start: 0,
      end: 0,
      topHeight: 0,
      bottomHeight: 0
    })
  })
})

describe('findExplorerRowIndex', function () {
  it('忽略分隔符与大小写；找不到返回 -1', function () {
    const rows = flattenExplorerRows(makeTree(), new Set(['0::', '0::a']))
    expect(findExplorerRowIndex(rows, '0::A/ONE.TS')).toBe(2)
    expect(findExplorerRowIndex(rows, null)).toBe(-1)
    expect(findExplorerRowIndex(rows, '0::nope')).toBe(-1)
  })
})
