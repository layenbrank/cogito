import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AgentStatus } from './agent-status'

vi.mock('@iconify/react/offline', function () {
  return { Icon: function StubIcon() { return null } }
})

describe('AgentStatus', function () {
  it('working 时展示耗时，state 另有读屏文本', function () {
    const html = renderToStaticMarkup(
      <AgentStatus
        state="working"
        label="生成中"
        elapsed="0:42"
      />
    )
    expect(html).toContain('生成中')
    expect(html).toContain('0:42')
    expect(html).toContain('进行中')
    expect(html).toContain('data-state="working"')
  })

  it('waiting 时的耗时同样展示，done 时不再展示', function () {
    const waiting = renderToStaticMarkup(
      <AgentStatus
        state="waiting"
        label="等待确认"
        elapsed="1:05"
      />
    )
    expect(waiting).toContain('1:05')

    const done = renderToStaticMarkup(
      <AgentStatus
        state="done"
        label="已结束"
        elapsed="1:05"
      />
    )
    expect(done).not.toContain('1:05')
    expect(done).toContain('已完成')
  })

  it('每个状态都带读屏可读的状态词，不只靠颜色', function () {
    const states = ['working', 'waiting', 'done', 'failed'] as const
    for (const state of states) {
      const html = renderToStaticMarkup(
        <AgentStatus
          state={state}
          label="x"
        />
      )
      expect(html).toContain('class="sr-only"')
    }
  })
})
