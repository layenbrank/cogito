import { describe, expect, it } from 'vitest'

import { findMessageMarkdown } from './message-markdown'

describe('findMessageMarkdown', function () {
  it('joins every non-empty text part in order', function () {
    const markdown = findMessageMarkdown([
      { type: 'text', text: '前言' },
      { type: 'tool-call' },
      { type: 'reasoning', text: '不该进剪贴板' },
      { type: 'text', text: '' },
      { type: 'text', text: '## Dimensions\n\n1. 模块边界 — 8.5' },
      { type: 'text', text: '收尾' }
    ])

    expect(markdown).toBe('前言\n\n## Dimensions\n\n1. 模块边界 — 8.5\n\n收尾')
  })

  it('prefers parts over content when both exist', function () {
    const markdown = findMessageMarkdown({
      parts: [{ type: 'text', text: '完整正文' }],
      content: [{ type: 'text', text: '截断预览' }]
    })

    expect(markdown).toBe('完整正文')
  })

  it('falls back to content when parts are missing', function () {
    const markdown = findMessageMarkdown({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' }
      ]
    })

    expect(markdown).toBe('第一段\n\n第二段')
  })
})
