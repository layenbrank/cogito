import { describe, expect, it } from 'vitest'

import { countBookmarkLinks, filterBookmarkTree, type BookmarkNode } from './tree'

const TREE: BookmarkNode[] = [
  {
    id: '1',
    title: '书签栏',
    children: [
      { id: '2', title: 'GitHub', url: 'https://github.com' },
      { id: '3', title: '新闻', url: 'https://news.example.com' }
    ]
  }
]

describe('countBookmarkLinks', function () {
  it('统计文件夹下的链接', function () {
    const root = TREE[0]
    expect(root).toBeTruthy()
    if (!root) return
    expect(countBookmarkLinks(root)).toBe(2)
  })
})

describe('filterBookmarkTree', function () {
  it('空关键字返回原树', function () {
    expect(filterBookmarkTree(TREE, '  ')).toEqual(TREE)
  })

  it('命中子节点时保留父级', function () {
    const filtered = filterBookmarkTree(TREE, 'github')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.children?.map(function (node) {
      return node.id
    })).toEqual(['2'])
  })

  it('文件夹标题命中时保留其下全部子项', function () {
    const filtered = filterBookmarkTree(TREE, '书签栏')
    expect(filtered[0]?.children).toHaveLength(2)
  })
})
