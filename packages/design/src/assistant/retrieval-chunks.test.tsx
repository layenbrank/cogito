import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RetrievalChunks } from './retrieval-chunks'
import type { RetrievalChunk } from './retrieval-chunks-state'

const CHUNKS: readonly RetrievalChunk[] = [
  {
    id: 'c1',
    source: 'migration-0.14.md',
    locator: 'wiki/migration-0.14.md',
    score: 0.91,
    text: 'The composer owns its draft from 0.14 onward.'
  },
  {
    id: 'c2',
    source: 'composer.tsx',
    locator: 'src/composer.tsx',
    score: 0.84,
    text: 'useDraft(threadId) subscribes to the per-thread draft slot.'
  },
  {
    id: 'c3',
    source: 'CHANGELOG.md',
    locator: 'CHANGELOG.md',
    score: 0.62,
    text: 'fix(react-lexical): clear stale drafts on thread switch.'
  }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <RetrievalChunks
      query="how does draft restore work"
      chunks={CHUNKS}
      visibleCount={CHUNKS.length}
      searching={false}
      {...props}
    />
  )
}

describe('RetrievalChunks', function () {
  it('查询词在药丸里，状态行给段数', function () {
    const html = markup()
    expect(html).toContain('data-slot="retrieval-chunks"')
    expect(html).toContain('data-state="done"')
    expect(html).toContain('how does draft restore work')
    expect(html).toContain('3 passages above threshold')
  })

  it('每条命中一张纸卡：来源 + 定位 + 分数 + 片段', function () {
    const html = markup()
    expect(html.split('data-slot="retrieval-chunk"').length - 1).toBe(3)
    expect(html).toContain('migration-0.14.md')
    expect(html).toContain('wiki/migration-0.14.md')
    expect(html).toContain('0.91')
    expect(html).toContain('The composer owns its draft from 0.14 onward.')
  })

  it('分数条是具名 meter，读数与行里印的分数同源', function () {
    const html = markup({ visibleCount: 1 })
    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-label="migration-0.14.md relevance score"')
    expect(html).toContain('aria-valuenow="91"')
    expect(html).toContain('aria-valuetext="0.91 of 1.00"')
    expect(html).toContain('width:91%')
  })

  it('≥0.8 的分数走 success 色，低于则弱色', function () {
    const html = markup()
    expect(html).toMatch(/text-success[^"]*">\s*0\.91/)
    expect(html).toMatch(/text-muted-foreground[^"]*">\s*0\.62/)
  })

  it('visibleCount 钳在 0…长度', function () {
    expect(markup({ visibleCount: -2 }).split('data-slot="retrieval-chunk"').length - 1).toBe(0)
    expect(markup({ visibleCount: 99 }).split('data-slot="retrieval-chunk"').length - 1).toBe(3)
  })

  it('检索中换 shimmer 文案，不读条数', function () {
    const html = markup({ searching: true, chunks: [], visibleCount: 0 })
    expect(html).toContain('data-state="searching"')
    expect(html).toContain('Retrieving')
    expect(html).not.toContain('passages above threshold')
  })

  it('零命中时给空态文案', function () {
    expect(markup({ chunks: [], visibleCount: 0 })).toContain('No passage above threshold')
  })

  it('模糊匹配的命中不给分数条，只给弱标记', function () {
    const html = renderToStaticMarkup(
      <RetrievalChunks
        query="q"
        chunks={[
          { id: 'f1', source: 'notes.md', locator: 'notes.md', score: 0, text: 's', fuzzy: true }
        ]}
        visibleCount={1}
        searching={false}
      />
    )
    expect(html).toContain('data-slot="retrieval-chunk-fuzzy"')
    expect(html).not.toContain('role="meter"')
    expect(html).not.toContain('data-slot="retrieval-chunk-score"')
  })
})
