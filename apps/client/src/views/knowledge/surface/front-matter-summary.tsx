/**
 * 当前文档 YAML frontmatter 摘要（只读展示，供大纲侧栏）。
 */
import { parseFrontMatter } from '@/views/knowledge/lib/front-matter.ts'

interface FrontMatterSummaryProps {
  source: string | null
}

interface FrontMatterRow {
  key: string
  value: string
}

function parseFrontMatterRows(raw: string): FrontMatterRow[] {
  const rows: FrontMatterRow[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (key) rows.push({ key, value })
  }
  return rows
}

function FrontMatterSummary(props: FrontMatterSummaryProps) {
  if (!props.source?.trim()) return null

  const rows = parseFrontMatterRows(props.source)
  if (rows.length === 0) return null

  return (
    <div className="border-b border-border px-2 py-2">
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Frontmatter</p>
      <dl className="space-y-0.5 text-[11px]">
        {rows.map(function (row) {
          return (
            <div
              key={row.key}
              className="flex gap-1">
              <dt className="shrink-0 text-muted-foreground">{row.key}:</dt>
              <dd className="min-w-0 truncate text-foreground">{row.value || '—'}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/** 从整篇 Markdown 源解析并展示 frontmatter 块 */
function FrontMatterSummaryFromMarkdown(props: { markdown: string | null }) {
  if (!props.markdown) return null
  const { frontMatter } = parseFrontMatter(props.markdown)
  return (
    <FrontMatterSummary source={frontMatter} />
  )
}

export { FrontMatterSummary, FrontMatterSummaryFromMarkdown }
