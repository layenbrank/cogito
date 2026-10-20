import { describe, expect, it } from 'vitest'

import { pruneImportRoots } from '@/views/bookmark/import/prune'
import type { BookmarkNode } from '@/views/bookmark/import/types'

const ROOTS: BookmarkNode[] = [
  {
    id: '1',
    title: '书签栏',
    children: [
      { id: '2', title: 'Example', url: 'https://example.com' },
      {
        id: '3',
        title: '工作',
        children: [{ id: '4', title: 'GitHub', url: 'https://github.com' }]
      }
    ]
  },
  {
    id: '5',
    title: '其他书签',
    children: [{ id: '6', title: 'Bing', url: 'https://bing.com' }]
  }
]

describe('pruneImportRoots', function () {
  it('keeps only selected folder subtree', function () {
    const pruned = pruneImportRoots(ROOTS, ['书签栏'])
    expect(pruned).toHaveLength(1)
    expect(pruned[0].title).toBe('书签栏')
    expect(pruned[0].children?.some(function (child) {
      return child.title === 'Example'
    })).toBe(true)
    expect(pruned[0].children?.some(function (child) {
      return child.title === '工作'
    })).toBe(true)
  })
})
