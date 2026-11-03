import { describe, expect, it } from 'vitest'

import { findParsedMarkdownOutputPath } from '@/views/knowledge/lib/parsed-source-output.ts'

function toPosix(path: string | null): string | null {
  return path ? path.replace(/\\/g, '/') : null
}

describe('findParsedMarkdownOutputPath', function () {
  it('maps office/pdf under raw/sources to raw/parsed/*.md', function () {
    expect(toPosix(findParsedMarkdownOutputPath('D:/kb', 'raw/sources/report.pdf'))).toBe(
      'D:/kb/raw/parsed/report.pdf.md'
    )
    expect(
      toPosix(findParsedMarkdownOutputPath('D:/kb', 'D:/kb/raw/sources/nested/deck.pptx'))
    ).toBe('D:/kb/raw/parsed/nested/deck.pptx.md')
  })

  it('skips plain markdown and unsupported types', function () {
    expect(findParsedMarkdownOutputPath('D:/kb', 'raw/sources/note.md')).toBeNull()
    expect(findParsedMarkdownOutputPath('D:/kb', 'raw/sources/pic.png')).toBeNull()
  })

  it('rejects path traversal', function () {
    expect(findParsedMarkdownOutputPath('D:/kb', 'raw/sources/../secret.pdf')).toBeNull()
  })
})
