import { describe, expect, it } from 'vitest'

import {
  findDefaultSelectedFolders,
  findRequiredFolderPaths,
  findSelectedLeaves
} from '@/views/bookmark/import/tree'
import type { BookmarkLeaf, BookmarkNode } from '@/views/bookmark/import/types'

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

const LEAVES: BookmarkLeaf[] = [
  { title: 'Example', url: 'https://example.com', sourcePath: '书签栏' },
  { title: 'GitHub', url: 'https://github.com', sourcePath: '书签栏/工作' },
  { title: 'Bing', url: 'https://bing.com', sourcePath: '其他书签' }
]

describe('bookmark tree selection', function () {
  it('defaults to bookmark bar only', function () {
    expect(findDefaultSelectedFolders(ROOTS)).toEqual(['书签栏'])
  })

  it('selects leaves under checked folders including nested', function () {
    const selected = findSelectedLeaves(LEAVES, ['书签栏'])
    expect(selected.map(function (leaf) {
      return leaf.title
    })).toEqual(['Example', 'GitHub'])
  })

  it('collects folder paths needed for persistence', function () {
    const selected = findSelectedLeaves(LEAVES, ['书签栏'])
    expect(findRequiredFolderPaths(selected)).toEqual(['书签栏', '书签栏/工作'])
  })
})
