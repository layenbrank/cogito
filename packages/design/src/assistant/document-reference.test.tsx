import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DocumentReference, type DocumentAnchor } from './document-reference'

const ANCHORS: readonly DocumentAnchor[] = [
  { page: 4, quote: 'Composer state moved off the thread runtime in 0.14.' },
  { page: 9, quote: 'Existing drafts migrate on first read; nothing to run by hand.' }
]

function markup(props: Partial<React.ComponentProps<typeof DocumentReference>> = {}) {
  return renderToStaticMarkup(
    <DocumentReference
      title="migration-0.14.md"
      pages={12}
      anchors={ANCHORS}
      activePage={4}
      {...props}
    />
  )
}

describe('DocumentReference', function () {
  it('抬头写文档名与「页数 · 引用处数」', function () {
    const html = markup()
    expect(html).toContain('data-slot="document-reference-title"')
    expect(html).toContain('migration-0.14.md')
    // design 包的默认文案是英文；中文由 client 的 labels 覆盖
    expect(html).toContain('12 pages')
    expect(html).toContain('2 cited')
  })

  it('没有 onJump 时锚点是只读行，不打 aria-current', function () {
    const html = markup()
    expect(html).toContain('data-slot="document-anchor"')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('aria-current')
  })

  it('有 onJump 时命中 activePage 的那个锚点带 aria-current', function () {
    const html = markup({ onJump: function () {} })
    expect(html).toContain('<button')
    expect(html).toContain('aria-current="true"')
    // 第二条（第 9 页）不是当前页
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
  })

  it('activePage 匹配不到任何锚点时没有当前项', function () {
    const html = markup({ activePage: 2, onJump: function () {} })
    expect(html).not.toContain('aria-current')
  })

  it('一处引用都没有时只渲染抬头', function () {
    const html = markup({ anchors: [], onJump: function () {} })
    expect(html).toContain('data-slot="document-reference-title"')
    expect(html).not.toContain('data-slot="document-anchor"')
  })
})
