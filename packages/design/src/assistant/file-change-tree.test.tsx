import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FileChangeTree } from './file-change-tree'
import { buildChangeNodes } from './file-change-tree-state'

const FILES = [
  { path: 'packages/core/src/convertMessages.ts', additions: 24, deletions: 6 },
  { path: 'packages/core/src/convertMessages.test.ts', additions: 41 },
  { path: 'README.md', additions: 5 }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(<FileChangeTree nodes={buildChangeNodes(FILES)} {...props} />)
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('FileChangeTree', function () {
  it('表头数的是文件，不是行：目录表头不把条数冲大', function () {
    const html = markup()
    expect(html).toContain('3 files changed')
    // 目录 1 行 + 文件 3 行
    expect(count(html, 'data-slot="file-change-tree-row"')).toBe(4)
  })

  it('净增删按文件合计', function () {
    const html = markup()
    expect(html).toContain('>+70<')
    expect(html).toContain('>−6<')
  })

  it('净增删就算为 0 也渲染（表头是「一共改了多少」）', function () {
    const html = renderToStaticMarkup(<FileChangeTree nodes={buildChangeNodes([{ path: 'a.ts' }])} />)
    expect(html).toContain('>+0<')
    expect(html).toContain('>−0<')
  })

  it('单个文件缺一半就不写那一半，不补 0', function () {
    const html = renderToStaticMarkup(
      <FileChangeTree nodes={buildChangeNodes([{ path: 'a.ts', additions: 3 }])} />
    )
    // 文件行只有 +3
    expect(html).toContain('>+3<')
    // 表头那处 `−0` 是规矩内的（净增删永远渲染），文件行不该再出现一次
    expect(count(html, '−0')).toBe(1)
    expect(count(html, '+0')).toBe(0)
  })

  it('缩进按 depth 走 padding-inline-start（RTL 能翻边）', function () {
    const html = markup()
    expect(html).toContain('padding-inline-start:0rem')
    expect(html).toContain('padding-inline-start:0.85rem')
  })

  it('visibleCount 只露前几行（渐进揭示）', function () {
    const html = markup({ visibleCount: 2 })
    expect(count(html, 'data-slot="file-change-tree-row"')).toBe(2)
    // 表头仍然按全量统计
    expect(html).toContain('3 files changed')
  })

  it('instant 时不挂入场动画', function () {
    expect(markup()).toContain('animate-in')
    expect(markup({ instant: true })).not.toContain('animate-in')
  })
})
