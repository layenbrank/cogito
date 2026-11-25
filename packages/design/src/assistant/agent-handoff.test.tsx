import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AgentHandoff } from './agent-handoff'

vi.mock('@iconify/react/offline', function () {
  return { Icon: function StubIcon() { return null } }
})

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('AgentHandoff', function () {
  it('渲染 from → to、原因与带走项', function () {
    const html = renderToStaticMarkup(
      <AgentHandoff
        from="Planner"
        to="Executor"
        reason="Plan is complete."
        carried={['工作目录 D:/repo', '任务 job-1']}
        settled={false}
      />
    )

    expect(html).toContain('Planner')
    expect(html).toContain('Executor')
    expect(html).toContain('Plan is complete.')
    expect(count(html, 'agent-handoff-carried')).toBeGreaterThan(0)
    expect(html).toContain('工作目录 D:/repo')
    expect(html).toContain('data-settled="false"')
    expect(html).toContain('正在交接')
  })

  it('settled 只切样式与读屏文案', function () {
    const html = renderToStaticMarkup(
      <AgentHandoff
        from="Planner"
        to="Executor"
        reason="done"
        carried={[]}
        settled
      />
    )
    expect(html).toContain('data-settled="true"')
    expect(html).toContain('已完成交接')
  })

  it('carried 为空数组时整段不渲染（不是空标题）', function () {
    const html = renderToStaticMarkup(
      <AgentHandoff
        from="A"
        to="B"
        reason="无上下文"
        carried={[]}
        settled
      />
    )
    expect(html).not.toContain('agent-handoff-carried')
  })
})
