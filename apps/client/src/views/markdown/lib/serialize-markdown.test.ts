import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '@/views/markdown/lib/parse-markdown.ts'
import { serializeHtmlToMarkdown } from '@/views/markdown/lib/serialize-markdown.ts'

describe('markdown roundtrip', function () {
  it('preserves front matter and headings', function () {
    const source = `---\ntitle: Demo\n---\n\n# Hello\n\nWorld\n`
    const parsed = parseMarkdown(source)
    expect(parsed.frontMatter).toContain('title: Demo')
    const again = serializeHtmlToMarkdown(parsed.html, parsed.frontMatter)
    expect(again).toContain('title: Demo')
    expect(again).toContain('# Hello')
  })

  it('keeps task list markers after serialize', function () {
    const source = `- [ ] Open\n- [x] Closed\n`
    const parsed = parseMarkdown(source)
    const again = serializeHtmlToMarkdown(parsed.html, null)
    expect(again.toLowerCase()).toMatch(/\[\s?\]/)
  })
})
