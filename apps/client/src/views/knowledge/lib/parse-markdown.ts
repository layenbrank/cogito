import { Marked } from 'marked'

import { toCalloutHtml } from '@/views/knowledge/lib/callout.ts'
import { enrichMarkdownBody } from '@/views/knowledge/lib/enrich-html.ts'
import { parseFrontMatter, type FrontMatterSlice } from '@/views/knowledge/lib/front-matter.ts'

const marked = new Marked({
  gfm: true,
  breaks: false
})

interface ParsedMarkdown extends FrontMatterSlice {
  html: string
}

function parseMarkdown(source: string): ParsedMarkdown {
  const sliced = parseFrontMatter(source)
  const enriched = enrichMarkdownBody(sliced.body)
  // callout 要在 marked 之后：`> [!x]` 得先被当成引用块解析出来
  const html = toCalloutHtml(marked.parse(enriched, { async: false }))
  return {
    frontMatter: sliced.frontMatter,
    body: sliced.body,
    html
  }
}

export type { ParsedMarkdown }
export { parseMarkdown }
