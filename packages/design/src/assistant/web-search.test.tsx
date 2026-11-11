import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WebSearch } from './web-search'

const RESULTS = [
  {
    title: 'Persisting composer state across threads',
    domain: 'assistant-ui.com',
    href: 'https://assistant-ui.com/a'
  },
  {
    title: 'Draft autosave patterns in chat UIs',
    domain: 'patterns.dev',
    href: 'https://patterns.dev/b'
  },
  {
    title: 'useSyncExternalStore and derived state',
    domain: 'react.dev',
    href: 'https://react.dev/c'
  }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <WebSearch
      query="assistant-ui draft persistence"
      results={RESULTS}
      visibleResults={RESULTS.length}
      searching={false}
      cycle={0}
      {...props}
    />
  )
}

describe('WebSearch', function () {
  it('查询词在药丸里，状态行给条数', function () {
    const html = markup()
    expect(html).toContain('data-slot="web-search"')
    expect(html).toContain('data-state="done"')
    expect(html).toContain('assistant-ui draft persistence')
    expect(html).toContain('Read 3 sources')
  })

  it('每条结果一行：徽章 + 标题 + 域名', function () {
    const html = markup()
    expect(html.split('data-slot="web-search-result"').length - 1).toBe(3)
    expect(html).toContain('Persisting composer state across threads')
    expect(html).toContain('assistant-ui.com')
    expect(html).toContain('>A<')
  })

  it('visibleResults 只放前 N 条', function () {
    expect(markup({ visibleResults: 1 }).split('data-slot="web-search-result"').length - 1).toBe(1)
  })

  it('检索中换 shimmer 文案，不算条数', function () {
    const html = markup({ searching: true, results: [], visibleResults: 0 })
    expect(html).toContain('data-state="searching"')
    expect(html).toContain('Searching the web')
    expect(html).not.toContain('Read 0 sources')
  })

  it('零结果且不在检索中时给空态文案', function () {
    expect(markup({ results: [], visibleResults: 0 })).toContain('No sources found')
  })

  it('没有链接的结果行不可点', function () {
    const html = renderToStaticMarkup(
      <WebSearch
        query="q"
        results={[{ title: 'orphan', domain: 'example.com' }]}
        visibleResults={1}
        searching={false}
        cycle={0}
      />
    )
    expect(html).not.toContain('<a')
  })

  it('链接行新窗口打开，且带 rel=noreferrer', function () {
    const html = markup({ visibleResults: 1 })
    expect(html).toContain('href="https://assistant-ui.com/a"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })
})
