import '@testing-library/jest-dom/vitest'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'
import { ToolCardTimeline } from '@/views/agent/chat/components/tool-card-timeline'

// 离线图标集在 jsdom 里很贵，且用例只断言结构与交互
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

type CardProps = ToolCallMessagePartProps & { outputText: string }

function makeProps(overrides: Record<string, unknown> = {}): CardProps {
  return {
    type: 'tool-call',
    toolCallId: 'call-calendar-1',
    toolName: 'app_calendar_read',
    args: { from: 0, to: 1 },
    argsText: '{"from":0,"to":1}',
    status: { type: 'complete' },
    outputText: '',
    ...overrides
  } as unknown as CardProps
}

function renderCard(props: CardProps) {
  return render(
    <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
      <ToolCardTimeline {...props} />
    </AssistantLabelsProvider>
  )
}

const NOW = Date.now()
const EVENTS = {
  events: [
    {
      id: 'c1',
      title: '周会',
      startAt: NOW - 3_600_000,
      endAt: NOW - 1_800_000,
      notes: '会议室 A'
    },
    { id: 'c2', title: '评审', startAt: NOW - 600_000, endAt: NOW + 600_000 },
    { id: 'c3', title: '发布', startAt: NOW + 3_600_000, endAt: NOW + 5_400_000 }
  ]
}

describe('时间轴卡', function () {
  it('日程逐条排成竖轴：标题、时刻与三态', function () {
    const { container } = renderCard(makeProps({ result: EVENTS }))
    expect(container.querySelector('[data-slot="timeline"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="timeline-event"]')).toHaveLength(3)
    expect(screen.getByText('周会')).toBeInTheDocument()
    expect(screen.getByText(/会议室 A/)).toBeInTheDocument()
    const rows = Array.from(container.querySelectorAll('[data-slot="timeline-event"]'))
    expect(
      rows.map(function (node) {
        return node.getAttribute('data-when')
      })
    ).toEqual(['past', 'now', 'future'])
  })

  it('不再把整块 JSON 当正文', function () {
    const { container } = renderCard(
      makeProps({ result: EVENTS, outputText: JSON.stringify(EVENTS) })
    )
    expect(container.textContent).not.toContain('"startAt"')
  })

  it('结果还没到时给「正在读取日程」', function () {
    renderCard(makeProps({ result: undefined, status: { type: 'running' } }))
    expect(screen.getByText('正在读取日程')).toBeInTheDocument()
  })

  it('一条安排都没有时只留一行状态，不画空轴', function () {
    const { container } = renderCard(makeProps({ result: { events: [] } }))
    expect(screen.getByText('这段时间没有安排')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="timeline"]')).toBeNull()
  })

  it('只有一条安排时用详情卡：日期 + 标题 + 时段 · 地点', function () {
    const start = new Date(2026, 6, 24, 9, 0).getTime()
    const end = new Date(2026, 6, 24, 9, 30).getTime()
    const { container } = renderCard(
      makeProps({
        result: {
          events: [{ id: 'c1', title: '设计评审', startAt: start, endAt: end, notes: '会议室 B' }]
        }
      })
    )
    expect(container.querySelector('[data-slot="event-card"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="timeline"]')).toBeNull()
    expect(screen.getByText('7月24日 · 周五')).toBeInTheDocument()
    expect(screen.getByText('设计评审')).toBeInTheDocument()
    expect(screen.getByText('09:00 – 09:30 · 会议室 B')).toBeInTheDocument()
  })

  it('原始结果默认折叠，点开才出现', function () {
    const raw = JSON.stringify(EVENTS)
    const { container } = renderCard(makeProps({ result: EVENTS, outputText: raw }))
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByText('原始结果'))
    expect(container.querySelector('pre')?.textContent).toBe(raw)
  })
})
