/**
 * `CodeDiff` 的折叠口径：只有「`expanded` + `onToggle` 都给了」才真的折叠，
 * 折叠时正文**整段不挂载**（大 diff 不进布局）——这里用静态渲染断言这一点。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CodeDiff, type DiffLine } from './code-diff'

const LINES: DiffLine[] = [
  { kind: 'context', text: 'const a = 1' },
  { kind: 'removed', text: 'const b = 2' },
  { kind: 'added', text: 'const b = 3' }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <CodeDiff
      filename="a.ts"
      additions={1}
      deletions={1}
      lines={LINES}
      cycle={0}
      {...props}
    />
  )
}

describe('CodeDiff', function () {
  it('stays expanded when no collapse props are given', function () {
    const html = markup()
    expect(html).not.toContain('<button')
    expect(html).not.toContain('data-state')
    expect(html).toContain('const b = 2')
    expect(html).toContain('+1')
  })

  it('drops the body from the markup while collapsed', function () {
    const html = markup({ expanded: false, onToggle: function () {} })
    expect(html).toContain('data-state="closed"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Expand diff')
    // 标题栏保留信息量：文件名与 +/− 都还在，只有正文不挂载
    expect(html).toContain('a.ts')
    expect(html).toContain('+1')
    expect(html).not.toContain('const b = 2')
    expect(html).not.toContain('const a = 1')
  })

  it('renders the body again when expanded', function () {
    const html = markup({ expanded: true, onToggle: function () {} })
    expect(html).toContain('data-state="open"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Collapse diff')
    expect(html).toContain('const b = 2')
  })

  it('never hides the body without a way to open it again', function () {
    // 漏传 onToggle：宁可按展开渲染，避免「藏了又打不开」
    const html = markup({ expanded: false })
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Expand diff')
    expect(html).toContain('const b = 2')
  })
})
