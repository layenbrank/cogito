import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SubagentList } from './subagent-list'

// 离线图标集在 SSR 里很贵，用例只看结构与无障碍数值
vi.mock('@iconify/react/offline', function () {
  return { Icon: function StubIcon() { return null } }
})

const AGENTS = [
  { name: 'Explore runtime', model: 'sonnet' },
  { name: 'Fix composer', model: 'haiku' }
]

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('SubagentList', function () {
  it('按完成数给前 N 张卡打勾，其余是转圈', function () {
    const html = renderToStaticMarkup(
      <SubagentList
        agents={AGENTS}
        completedCount={1}
        progress={[100, 0]}
        showSummary={false}
        summaryAgent={{ name: '总结', model: '' }}
      />
    )

    expect(count(html, 'data-slot="subagent-card"')).toBe(2)
    expect(html).toContain('data-state="done"')
    expect(html).toContain('data-state="running"')
  })

  it('进度条把 0…100 夹住并暴露给读屏，缺失值读 0', function () {
    const html = renderToStaticMarkup(
      <SubagentList
        agents={AGENTS}
        completedCount={0}
        progress={[140, Number.NaN]}
        showSummary={false}
        summaryAgent={{ name: '总结', model: '' }}
      />
    )

    expect(html).toContain('aria-label="Explore runtime"')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('aria-label="Fix composer"')
    expect(html).toContain('aria-valuenow="0"')
  })

  it('summary 卡只在 showSummary 时出现，且没有百分比', function () {
    const hidden = renderToStaticMarkup(
      <SubagentList
        agents={AGENTS}
        completedCount={2}
        progress={[100, 100]}
        showSummary={false}
        summaryAgent={{ name: '汇总', model: '' }}
      />
    )
    expect(hidden).not.toContain('data-slot="subagent-summary"')

    const shown = renderToStaticMarkup(
      <SubagentList
        agents={AGENTS}
        completedCount={2}
        progress={[100, 100]}
        showSummary
        summaryAgent={{ name: '汇总', model: '' }}
      />
    )
    expect(shown).toContain('data-slot="subagent-summary"')
    // summary 的进度条没有完成态，因此不带 aria-valuenow
    const summaryPart = shown.slice(shown.indexOf('data-slot="subagent-summary"'))
    expect(summaryPart).not.toContain('aria-valuenow')
  })

  it('没有子 agent 也没有 summary 时什么都不渲染', function () {
    const html = renderToStaticMarkup(
      <SubagentList
        agents={[]}
        completedCount={0}
        progress={[]}
        showSummary={false}
        summaryAgent={{ name: '汇总', model: '' }}
      />
    )
    expect(html).toBe('')
  })
})
