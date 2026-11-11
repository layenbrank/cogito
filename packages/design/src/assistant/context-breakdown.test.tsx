import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ContextBreakdown, type ContextSegment } from './context-breakdown'
import { AssistantLabelsProvider } from './labels'

const SEGMENTS: ContextSegment[] = [
  { label: 'System prompt', tokens: 1800, tint: 'bg-foreground/45' },
  { label: 'Tools', tokens: 4200, tint: 'bg-foreground/25' },
  { label: 'Attached files', tokens: 38500, tint: 'bg-blue-500/60' },
  { label: 'Conversation', tokens: 68400, tint: 'bg-blue-500' }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ContextBreakdown
      segments={SEGMENTS}
      limit={128_000}
      {...props}
    />
  )
}

describe('ContextBreakdown', function () {
  it('表头是 Context + 千分位的「已用 / 上限」', function () {
    const html = markup()
    expect(html).toContain('data-slot="context-breakdown"')
    expect(html).toContain('>Context</span>')
    expect(html).toContain('data-slot="context-breakdown-total"')
    expect(html).toContain('112,900 / 128,000')
  })

  it('剩余是算出来的：128,000 - 112,900 = 15,100，只进图例', function () {
    const html = markup()
    expect(html).toContain('data-slot="context-breakdown-headroom"')
    expect(html).toContain('Headroom')
    expect(html).toContain('>15,100</span>')
    // 剩余不是传进来的段：色条里只该有四段
    expect(html.match(/role="meter"/g)).toHaveLength(4)
  })

  it('每段都是 meter：aria-valuenow 是占上限的百分比，valuetext 与图例同数字', function () {
    const html = markup()
    expect(html).toContain('aria-label="System prompt context usage"')
    expect(html).toContain('aria-valuenow="1.4"')
    expect(html).toContain('aria-valuetext="1,800 of 128,000"')
    expect(html).toContain('aria-valuenow="53.4"')
    expect(html).toContain('aria-valuetext="68,400 of 128,000"')
    // 宽度按 limit 算，不做四舍五入：只断言量级，别把浮点尾巴写进断言
    expect(html).toMatch(/width:30\.0781\d*%/)
    expect(html).toMatch(/width:53\.4375\d*%/)
  })

  it('图例顺序就是传入顺序，色条与圆点共用同一个 tint', function () {
    const html = markup()
    const order = [
      'System prompt</span>',
      'Tools</span>',
      'Attached files</span>',
      'Conversation</span>'
    ]
    let last = -1
    for (const label of order) {
      const at = html.indexOf(label)
      expect(at).toBeGreaterThan(last)
      last = at
    }
    expect(html).toContain('bg-foreground/45')
    expect(html).toContain('bg-blue-500/60')
  })

  it('宽度四舍五入到 0 的段不进色条，但图例仍然列出来', function () {
    const html = markup({
      segments: [
        { label: 'System prompt', tokens: 200, tint: 'bg-foreground/45' },
        { label: 'Tools', tokens: 1, tint: 'bg-foreground/25' }
      ]
    })
    expect(html.match(/role="meter"/g)).toHaveLength(1)
    expect(html).toContain('>Tools</span>')
    expect(html).toContain('>1</span>')
  })

  it('过 85% 表头转琥珀；没到就保持 muted', function () {
    const alert = markup()
    expect(alert).toContain('text-amber-600')
    const calm = markup({
      segments: [{ label: 'Conversation', tokens: 1000, tint: 'bg-blue-500' }]
    })
    expect(calm).not.toContain('text-amber-600')
    expect(calm).toContain('>1,000 / 128,000</span>')
  })

  it('limit 为 0 不除零：表头是 0 / 0，不报警，色条里一段都没有', function () {
    const html = markup({ limit: 0 })
    expect(html).toContain('>112,900 / 0</span>')
    expect(html).not.toContain('text-amber-600')
    expect(html).not.toContain('role="meter"')
    expect(html).toContain('>0</span>')
  })

  it('className 落在根上，其余 div 属性照传', function () {
    const html = markup({ className: 'max-w-md', id: 'window' })
    const start = html.indexOf('<div data-slot="context-breakdown"')
    const rootTag = html.slice(start, html.indexOf('>', start))
    expect(rootTag).toContain('max-w-md')
    expect(html).toContain('id="window"')
  })

  it('文案走 labels：注入中文后英文不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider
        labels={{
          contextTitle: '上下文',
          contextHeadroom: '剩余',
          contextMeterLabel: (label) => label + '占用',
          contextMeterValue: (used, limit) => `${used} / ${limit}`
        }}>
        <ContextBreakdown
          segments={SEGMENTS}
          limit={128_000}
        />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('>上下文</span>')
    expect(html).toContain('>剩余</span>')
    expect(html).toContain('aria-label="Tools占用"')
    expect(html).toContain('aria-valuetext="4,200 / 128,000"')
    expect(html).not.toContain('Headroom')
  })
})
