import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AssistantLabelsProvider } from './labels'
import { ScheduleCard, type ScheduleRun } from './schedule-card'

vi.mock('@iconify/react/offline', function () {
  return {
    Icon: function StubIcon(props: { icon: string; className?: string }) {
      return (
        <span
          data-icon={props.icon}
          className={props.className}
        />
      )
    }
  }
})

const HISTORY: ScheduleRun[] = [
  { id: '1', at: 'Today, 06:00', ok: true },
  { id: '2', at: 'Sat, 06:00', ok: false }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ScheduleCard
      name="Triage the issue queue"
      cadence="every day at 06:00"
      nextRun="Tomorrow, 06:00"
      enabled
      history={HISTORY}
      {...props}
    />
  )
}

describe('ScheduleCard', function () {
  it('抬头按 图标 / 名称 / 周期 / 开关 排，根上有元素标记', function () {
    const html = markup()
    expect(html).toContain('data-slot="schedule-card"')
    expect(html).toContain('data-enabled=""')
    expect(html).toContain('data-icon="lucide:clock"')

    const name = html.indexOf('data-slot="schedule-card-name"')
    const cadence = html.indexOf('data-slot="schedule-card-cadence"')
    const toggle = html.indexOf('data-slot="schedule-card-switch"')
    expect(name).toBeGreaterThan(0)
    expect(name).toBeLessThan(cadence)
    expect(cadence).toBeLessThan(toggle)
    expect(html).toContain('Triage the issue queue')
    expect(html).toContain('every day at 06:00')
  })

  it('开着：开关 aria-checked，药丸给下次时间，无障碍名是「暂停」', function () {
    const html = markup()
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-label="Pause Triage the issue queue"')
    expect(html).toContain('translate-x-4')
    expect(html).toContain('data-state="scheduled"')
    expect(html).toContain('Tomorrow, 06:00')
  })

  it('关着：药丸换成「已暂停」并压暗，开关的调用词变「恢复」', function () {
    const html = markup({ enabled: false })
    expect(html).not.toContain('data-enabled=""')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('aria-label="Resume Triage the issue queue"')
    expect(html).toContain('data-state="paused"')
    expect(html).toContain('Paused')
    expect(html).not.toContain('Tomorrow, 06:00')
    const next = html.indexOf('data-slot="schedule-card-next"')
    const tag = html.slice(html.lastIndexOf('<div', next), html.indexOf('>', next))
    expect(tag).toContain('opacity-60')
  })

  it('最近执行：成功对勾 / 失败叉，顺序就是传入顺序', function () {
    const html = markup()
    const first = html.indexOf('data-state="ok"')
    const second = html.indexOf('data-state="failed"')
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(second)
    expect(html).toContain('>ok</span>')
    expect(html).toContain('>failed</span>')
    expect(html).toContain('Today, 06:00')
    expect(html).toContain('Sat, 06:00')
    expect(html).toContain('data-icon="lucide:check"')
    expect(html).toContain('data-icon="lucide:x"')
    expect(html).toContain('text-success')
    expect(html).toContain('text-destructive')
  })

  it('没有历史：只留标题，不留空行', function () {
    const html = markup({ history: [] })
    expect(html).toContain('data-slot="schedule-card-runs"')
    expect(html).toContain('Recent runs')
    expect(html).not.toContain('data-slot="schedule-card-run"')
  })

  it('className 落在根上，其余 div 属性照传', function () {
    const html = markup({ className: 'max-w-md', id: 'nightly' })
    const start = html.indexOf('<div data-slot="schedule-card"')
    const rootTag = html.slice(start, html.indexOf('>', start))
    expect(rootTag).toContain('max-w-md')
    expect(html).toContain('id="nightly"')
  })

  it('文案走 labels：注入中文后英文不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider
        labels={{
          scheduleNext: '下次',
          scheduleRecentRuns: '最近执行',
          schedulePaused: '已暂停',
          scheduleRunOk: '成功',
          scheduleRunFailed: '失败',
          schedulePause: (name) => `暂停 ${name}`,
          scheduleResume: (name) => `启用 ${name}`
        }}>
        <ScheduleCard
          name="每日整理"
          cadence="每天 09:00"
          nextRun="11-11 09:00"
          enabled={false}
          history={HISTORY}
        />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('>下次</span>')
    expect(html).toContain('>最近执行</span>')
    expect(html).toContain('已暂停')
    expect(html).toContain('aria-label="启用 每日整理"')
    expect(html).not.toContain('>Recent runs</span>')
  })
})
