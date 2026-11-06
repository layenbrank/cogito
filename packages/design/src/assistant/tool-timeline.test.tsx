import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ToolTimeline, type ToolTimelineStep } from './tool-timeline'

const STEPS: ToolTimelineStep[] = [
  { id: 'a', verb: 'Thinking', chip: 'planning the change', icon: 'lucide:sparkles' },
  { id: 'b', verb: 'Read', chip: 'thread.tsx', icon: 'lucide:file-search' },
  { id: 'c', verb: 'Ran', chip: 'pnpm vitest', icon: 'lucide:terminal' },
  { id: 'd', verb: 'Edited', chip: 'composer.tsx', icon: 'lucide:pen-line' }
]

const STATS = [
  { file: 'composer.tsx', added: 14, removed: 3 },
  { file: 'use-draft.ts', added: 42 }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ToolTimeline
      steps={STEPS}
      open
      onOpenChange={function () {}}
      restingLabel="4 steps · 2 files changed"
      activeLabel="Working"
      {...props}
    />
  )
}

function count(html: string, needle: string) {
  return html.split(needle).length - 1
}

describe('ToolTimeline', function () {
  it('折叠条用 restingLabel，展开后逐步列出动词与芯片', function () {
    const html = markup()
    expect(html).toContain('data-slot="tool-timeline"')
    expect(html).toContain('4 steps · 2 files changed')
    expect(count(html, 'data-slot="tool-timeline-step"')).toBe(4)
    expect(html).toContain('Read')
    expect(html).toContain('thread.tsx')
    expect(html).toContain('pnpm vitest')
  })

  it('streaming 时换成 activeLabel，并且只有最后一步在闪', function () {
    const html = markup({ streaming: true })
    expect(html).toContain('Working')
    // 折叠条上的 activeLabel 自己在闪，步骤行里只有最后一步在闪
    const rows = html.split('data-slot="tool-timeline-step"').slice(1)
    const shimmering = rows.filter(function (row) {
      return row.includes('shimmer')
    })
    expect(shimmering).toHaveLength(1)
    expect(rows[rows.length - 1]).toContain('shimmer')
  })

  it('visibleSteps 向下取整并钳进 0…steps.length', function () {
    expect(count(markup({ visibleSteps: 2 }), 'data-slot="tool-timeline-step"')).toBe(2)
    expect(count(markup({ visibleSteps: 2.9 }), 'data-slot="tool-timeline-step"')).toBe(2)
    // 超过总数按总数算
    expect(count(markup({ visibleSteps: 99 }), 'data-slot="tool-timeline-step"')).toBe(4)
    // 0 / 负数 = 一步还没露头（合法状态）
    expect(count(markup({ visibleSteps: 0 }), 'data-slot="tool-timeline-step"')).toBe(0)
  })

  it('文件统计整排省略：stats 为空时不留空行', function () {
    expect(markup({ stats: [] })).not.toContain('data-slot="tool-timeline-stats"')
  })

  it('缺 added / removed 就少写那一半，不补 0', function () {
    const html = markup({ stats: STATS })
    expect(count(html, 'data-slot="tool-timeline-stat"')).toBe(2)
    expect(html).toContain('+14')
    expect(html).toContain('−3')
    expect(html).toContain('+42')
    // use-draft.ts 没有 removed：整块里只出现一次「−」
    expect(count(html, '−')).toBe(1)
  })

  it('两条芯片相同的步骤仍是两行（不合并）', function () {
    const steps: ToolTimelineStep[] = [
      { id: 'a', verb: 'Read', chip: 'thread.tsx', icon: 'lucide:file-search' },
      { id: 'b', verb: 'Read', chip: 'thread.tsx', icon: 'lucide:file-search' }
    ]
    expect(count(markup({ steps }), 'data-slot="tool-timeline-step"')).toBe(2)
  })

  it('没有芯片时只留动词行', function () {
    const steps: ToolTimelineStep[] = [{ id: 'a', verb: 'Thinking', icon: 'lucide:sparkles' }]
    const html = markup({ steps })
    expect(html).toContain('Thinking')
    expect(html).not.toContain('data-slot="tool-timeline-chip"')
  })
})
