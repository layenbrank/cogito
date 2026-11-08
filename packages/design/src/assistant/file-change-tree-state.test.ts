import { describe, expect, it } from 'vitest'

import {
  buildChangeNodes,
  formatChangedFilesLabel,
  normalizePath,
  resolveVisibleRows,
  summarizeChangeNodes
} from './file-change-tree-state'

describe('normalizePath', function () {
  it('统一分隔符并去掉 ./ 与尾斜杠', function () {
    expect(normalizePath('packages\\core\\src\\a.ts')).toBe('packages/core/src/a.ts')
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts')
    expect(normalizePath('src/dir/')).toBe('src/dir')
  })
})

describe('buildChangeNodes', function () {
  it('目录表头 depth 0，文件行 depth 1', function () {
    const nodes = buildChangeNodes([
      { path: 'packages/core/src/a.ts', additions: 3 },
      { path: 'packages/core/src/b.ts', additions: 1 }
    ])
    expect(nodes).toEqual([
      { path: 'packages/core/src', name: 'packages/core/src', depth: 0, kind: 'folder' },
      {
        path: 'packages/core/src/a.ts',
        name: 'a.ts',
        depth: 1,
        kind: 'file',
        additions: 3,
        deletions: 0
      },
      {
        path: 'packages/core/src/b.ts',
        name: 'b.ts',
        depth: 1,
        kind: 'file',
        additions: 1,
        deletions: 0
      }
    ])
  })

  it('目录只分一层：整条路径当表头，不拆成三级', function () {
    const nodes = buildChangeNodes([{ path: 'a/b/c/d.ts' }])
    expect(nodes.map((node) => node.name)).toEqual(['a/b/c', 'd.ts'])
  })

  it('没有目录的文件顶格（depth 0），不补一个空表头', function () {
    const nodes = buildChangeNodes([{ path: 'README.md', additions: 2 }])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ path: 'README.md', depth: 0, kind: 'file' })
  })

  it('同一文件被改两次合成一行，增删相加', function () {
    const nodes = buildChangeNodes([
      { path: 'src/a.ts', additions: 4, deletions: 1 },
      { path: 'src/a.ts', additions: 2 }
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes[1]).toMatchObject({ kind: 'file', additions: 6, deletions: 1 })
  })

  it('目录交错时不出重复表头，同目录的文件挨在一起', function () {
    const nodes = buildChangeNodes([{ path: 'a/x.ts' }, { path: 'b/y.ts' }, { path: 'a/z.ts' }])
    expect(nodes.map((node) => node.name)).toEqual(['a', 'x.ts', 'z.ts', 'b', 'y.ts'])
    // 官方示例的 buildFileTree 在这里会把 z.ts 落到 b 的块里
    expect(nodes.filter((node) => node.kind === 'folder')).toHaveLength(2)
  })

  it('空路径丢掉（没法当 key，也没法显示）', function () {
    expect(buildChangeNodes([{ path: '   ' }, { path: '' }])).toEqual([])
  })
})

describe('summarizeChangeNodes', function () {
  it('只数文件行，目录表头不算文件', function () {
    const nodes = buildChangeNodes([
      { path: 'src/a.ts', additions: 10, deletions: 2 },
      { path: 'src/b.ts', additions: 5 }
    ])
    expect(summarizeChangeNodes(nodes)).toEqual({ files: 2, additions: 15, deletions: 2 })
  })

  it('缺字段当 0', function () {
    const nodes = buildChangeNodes([{ path: 'a.ts' }])
    expect(summarizeChangeNodes(nodes)).toEqual({ files: 1, additions: 0, deletions: 0 })
  })
})

describe('resolveVisibleRows', function () {
  it('不传 = 全出', function () {
    expect(resolveVisibleRows(undefined, 4)).toBe(4)
  })

  it('向下取整并钳进 0…total', function () {
    expect(resolveVisibleRows(2.9, 4)).toBe(2)
    expect(resolveVisibleRows(0.9, 4)).toBe(0)
    expect(resolveVisibleRows(99, 4)).toBe(4)
    expect(resolveVisibleRows(-3, 4)).toBe(0)
    expect(resolveVisibleRows(3, 0)).toBe(0)
    expect(resolveVisibleRows(Number.NaN, 4)).toBe(0)
  })
})

describe('formatChangedFilesLabel', function () {
  it('走 labels，组件里不写死语言', function () {
    expect(formatChangedFilesLabel(4, { filesChanged: (count) => `${count} 个文件改动` })).toBe(
      '4 个文件改动'
    )
  })
})
