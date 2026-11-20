import { describe, expect, it } from 'vitest'

import { MARKDOWN_LIMIT } from './constants.ts'
import { composeMarkdown } from './markdown.ts'

describe('composeMarkdown', function () {
  it('keeps the previous frontmatter shape', function () {
    const markdown = composeMarkdown('A "B"', 'https://example.com', ' hello ', '2026-01-01T00:00:00.000Z')
    expect(markdown).toBe(
      [
        '---',
        'title: "A \\"B\\""',
        'source_url: "https://example.com"',
        'clipped_at: "2026-01-01T00:00:00.000Z"',
        '---',
        '',
        '# A "B"',
        '',
        '> https://example.com',
        '',
        'hello',
        ''
      ].join('\n')
    )
  })

  it('truncates the body at the previous limit', function () {
    const markdown = composeMarkdown('t', 'https://example.com', 'a'.repeat(MARKDOWN_LIMIT + 20), '2026-01-01T00:00:00.000Z')
    const body = markdown.split('\n\n').at(-1) ?? ''
    expect(body.trim().length).toBe(MARKDOWN_LIMIT)
  })
})
