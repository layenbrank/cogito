import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Timeline } from './timeline'
import type { TimelineEvent } from './timeline-state'

const EVENTS: readonly TimelineEvent[] = [
  {
    id: 'e1',
    when: 'past',
    time: '09:02',
    title: 'Issue filed',
    detail: 'Draft survives a thread switch'
  },
  {
    id: 'e2',
    when: 'now',
    time: '10:15',
    title: 'Fix in review',
    detail: 'Clears the slot on switch'
  },
  { id: 'e3', when: 'future', time: '11:00', title: 'Release 0.14.1' }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <Timeline
      events={EVENTS}
      visibleCount={EVENTS.length}
      {...props}
    />
  )
}

describe('Timeline', function () {
  it('一条一行，顺序按给定顺序，不按时刻重排', function () {
    const html = markup()
    expect(html).toContain('data-slot="timeline"')
    expect(html.split('data-slot="timeline-event"').length - 1).toBe(3)
    expect(html.indexOf('Issue filed')).toBeLessThan(html.indexOf('Fix in review'))
    expect(html.indexOf('Fix in review')).toBeLessThan(html.indexOf('Release 0.14.1'))
  })

  it('左列时刻 + 标题；有说明才多一行', function () {
    const html = markup()
    expect(html).toContain('09:02')
    expect(html).toContain('Clears the slot on switch')
    expect(html.split('data-slot="timeline-detail"').length - 1).toBe(2)
    expect(html).toContain('tabular-nums')
  })

  it('三态圆点：过去实心灰、现在主色带光晕、将来空心描边', function () {
    const rows = markup().split('data-slot="timeline-event"')
    expect(rows[1]).toContain('bg-muted-foreground')
    expect(rows[2]).toContain('bg-primary')
    expect(rows[2]).toContain('ring-4')
    expect(rows[3]).toContain('border border-muted-foreground bg-transparent')
  })

  it('现在的标题加粗，将来的标题调淡', function () {
    const rows = markup().split('data-slot="timeline-event"')
    expect(rows[2]).toContain('font-medium')
    expect(rows[3]).toContain('text-muted-foreground')
  })

  it('最后一条可见事件不画连线', function () {
    expect(markup().split('data-slot="timeline-connector"').length - 1).toBe(2)
    const first = markup({ visibleCount: 1 })
    expect(first.split('data-slot="timeline-connector"').length - 1).toBe(0)
  })

  it('可见条数钳制：负数 / 超总数 / 小数', function () {
    expect(markup({ visibleCount: -2 }).split('data-slot="timeline-event"').length - 1).toBe(0)
    expect(markup({ visibleCount: 99 }).split('data-slot="timeline-event"').length - 1).toBe(3)
    expect(markup({ visibleCount: 1.9 }).split('data-slot="timeline-event"').length - 1).toBe(1)
  })

  it('读屏按条播报：role=list + listitem', function () {
    const html = markup()
    expect(html).toContain('role="list"')
    expect(html.split('role="listitem"').length - 1).toBe(3)
  })

  it('一根空轴：一条事件都没有时只有根节点', function () {
    const html = markup({ events: [] })
    expect(html).toContain('data-slot="timeline"')
    expect(html).not.toContain('data-slot="timeline-event"')
  })
})
