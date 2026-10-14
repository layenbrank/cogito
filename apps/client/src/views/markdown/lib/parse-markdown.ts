import { Marked } from 'marked'

import { enrichMarkdownBody } from '@/views/markdown/lib/enrich-html.ts'
import { parseFrontMatter, type FrontMatterSlice } from '@/views/markdown/lib/front-matter.ts'

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
  const html = marked.parse(enriched, { async: false }) as string
  return {
    frontMatter: sliced.frontMatter,
    body: sliced.body,
    html
  }
}

export type { ParsedMarkdown }
export { parseMarkdown }
