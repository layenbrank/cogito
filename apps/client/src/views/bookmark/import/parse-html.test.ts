import { describe, expect, it } from 'vitest'

import { flattenBookmarkLeaves } from '@/views/bookmark/import/flatten'
import { parseBookmarkHtml } from '@/views/bookmark/import/parse-html'

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3>书签栏</H3>
  <DL><p>
    <DT><A HREF="https://example.com/">Example</A>
    <DT><H3>工作</H3>
    <DL><p>
      <DT><A HREF="https://github.com/">GitHub</A>
    </DL><p>
  </DL><p>
  <DT><H3>其他书签</H3>
  <DL><p>
    <DT><A HREF="https://bing.com/">Bing</A>
  </DL><p>
</DL><p>
`

describe('parseBookmarkHtml', function () {
  it('parses folders and links', function () {
    const roots = parseBookmarkHtml(SAMPLE)
    expect(roots.map(function (n) {
      return n.title
    })).toEqual(['书签栏', '其他书签'])
    const leaves = flattenBookmarkLeaves(roots)
    expect(leaves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Example',
          url: 'https://example.com',
          sourcePath: '书签栏'
        }),
        expect.objectContaining({
          title: 'GitHub',
          url: 'https://github.com',
          sourcePath: '书签栏/工作'
        }),
        expect.objectContaining({
          title: 'Bing',
          sourcePath: '其他书签'
        })
      ])
    )
  })
})
