import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import { serializeHtmlToMarkdown } from '@/views/knowledge/lib/serialize-markdown.ts'

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

  it('round-trips wikilinks with and without alias', function () {
    const source = `见 [[示例空间]] 与 [[另一页|显示名]]\n`
    const parsed = parseMarkdown(source)
    expect(parsed.html).toContain('data-wikilink')
    expect(parsed.html).toContain('data-wikilink-title="示例空间"')
    const again = serializeHtmlToMarkdown(parsed.html, null)
    expect(again).toContain('[[示例空间]]')
    expect(again).toContain('[[另一页|显示名]]')
    expect(again).not.toContain(']()')
  })

  it('leaves wikilinks inside code alone', function () {
    const source = '`[[行内]]`\n\n```\n[[围栏]]\n```\n'
    const parsed = parseMarkdown(source)
    expect(parsed.html).not.toContain('data-wikilink')
    expect(parsed.html).toContain('[[行内]]')
    expect(parsed.html).toContain('[[围栏]]')
  })

  it('round-trips a callout block', function () {
    const source = '> [!warning] 数据是旧的\n>\n> 这页的结论基于 2023 年的样本。\n'
    const parsed = parseMarkdown(source)
    expect(parsed.html).toContain('data-callout="warning"')
    expect(parsed.html).toContain('data-callout-title="数据是旧的"')
    const again = serializeHtmlToMarkdown(parsed.html, null)
    expect(again).toContain('> [!warning] 数据是旧的')
    expect(again).toContain('> 这页的结论基于 2023 年的样本。')
    expect(again).not.toContain('> [!warning] 数据是旧的\n> >')
  })

  it('keeps the default label when a callout has no title', function () {
    const source = '> [!note]\n> 只写类型。\n'
    const parsed = parseMarkdown(source)
    expect(parsed.html).toContain('data-callout="note"')
    expect(parsed.html).toContain('data-callout-title="提示"')
  })

  it('leaves ordinary blockquotes alone', function () {
    const source = '> 普通引用\n'
    const parsed = parseMarkdown(source)
    expect(parsed.html).toContain('<blockquote>')
    expect(parsed.html).not.toContain('data-callout')
  })
})
