import { describe, expect, it } from 'vitest'

import { flattenBookmarkLeaves } from '@/views/bookmark/import/flatten'
import { parseChromeBookmarksJson } from '@/views/bookmark/import/parse-chrome-json'

const SAMPLE = JSON.stringify({
  roots: {
    bookmark_bar: {
      name: '书签栏',
      type: 'folder',
      children: [
        { name: 'Example', type: 'url', url: 'https://example.com/' },
        {
          name: '工作',
          type: 'folder',
          children: [{ name: 'GitHub', type: 'url', url: 'https://github.com/' }]
        }
      ]
    },
    other: {
      name: '其他书签',
      type: 'folder',
      children: [{ name: 'Bing', type: 'url', url: 'https://cn.bing.com/' }]
    }
  }
})

describe('parseChromeBookmarksJson', function () {
  it('parses chrome profile bookmarks', function () {
    const roots = parseChromeBookmarksJson(SAMPLE)
    const leaves = flattenBookmarkLeaves(roots)
    expect(leaves.some(function (leaf) {
      return leaf.sourcePath === '书签栏/工作' && leaf.title === 'GitHub'
    })).toBe(true)
    expect(leaves.some(function (leaf) {
      return leaf.sourcePath === '其他书签'
    })).toBe(true)
  })
})
