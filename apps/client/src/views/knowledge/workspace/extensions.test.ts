import { generateHTML, generateJSON } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import { findMarkdownExtensions } from '@/views/knowledge/workspace/extensions.ts'

/**
 * 节点 schema 的冒烟测试：`parseMarkdown` 产出的 HTML 要能被编辑器 schema 吃下并原样吐出。
 * 这类问题（例如 `content: 'block+'` 却喂了空节点、属性没声明就写在标签上）tsc 抓不到，
 * 只有真的走一次 json ↔ html 才会暴露。
 */
const extensions = findMarkdownExtensions({ isTypographyEnabled: false })

function roundTripHtml(html: string): string {
  return generateHTML(generateJSON(html, extensions), extensions)
}

describe('editor schema roundtrip', function () {
  it('keeps callouts with their type and title', function () {
    const parsed = parseMarkdown('> [!warning] 旧数据\n>\n> 结论基于 2023 年样本。\n')
    const html = roundTripHtml(parsed.html)
    expect(html).toContain('data-callout="warning"')
    expect(html).toContain('data-callout-title="旧数据"')
    expect(html).toContain('结论基于 2023 年样本。')
  })

  it('keeps wikilinks as marks', function () {
    const parsed = parseMarkdown('见 [[示例空间]]。\n')
    const html = roundTripHtml(parsed.html)
    expect(html).toContain('data-wikilink')
    expect(html).toContain('data-wikilink-title="示例空间"')
  })
})
