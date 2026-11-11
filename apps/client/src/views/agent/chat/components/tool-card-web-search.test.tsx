import '@testing-library/jest-dom/vitest'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'
import { ToolCardWebSearch } from '@/views/agent/chat/components/tool-card-web-search'

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
    toolCallId: 'call-web-1',
    toolName: 'web_search',
    args: { query: 'assistant-ui draft persistence' },
    argsText: '{"query":"assistant-ui draft persistence"}',
    status: { type: 'complete' },
    outputText: '',
    ...overrides
  } as unknown as CardProps
}

function renderCard(props: CardProps) {
  return render(
    <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
      <ToolCardWebSearch {...props} />
    </AssistantLabelsProvider>
  )
}

const STRUCTURED = {
  results: [
    { title: 'Persisting composer state across threads', url: 'https://assistant-ui.com/a' },
    { title: 'Draft autosave patterns in chat UIs', url: 'https://patterns.dev/b' },
    { title: 'useSyncExternalStore and derived state', url: 'https://react.dev/c' }
  ]
}

describe('联网搜索卡', function () {
  it('查询词进药丸，结果逐条列出标题与域名', function () {
    const { container } = renderCard(makeProps({ result: STRUCTURED }))
    expect(container.querySelector('[data-slot="web-search"]')).not.toBeNull()
    expect(screen.getByText('assistant-ui draft persistence')).toBeInTheDocument()
    expect(screen.getByText('读取 3 个来源')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="web-search-result"]')).toHaveLength(3)
    expect(screen.getByText('Persisting composer state across threads')).toBeInTheDocument()
    expect(screen.getByText('patterns.dev')).toBeInTheDocument()
  })

  it('标题来自结构化结果，不再把整块 JSON 当正文', function () {
    const { container } = renderCard(
      makeProps({ result: STRUCTURED, outputText: JSON.stringify(STRUCTURED) })
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('"results"')
    expect(text).toContain('Draft autosave patterns in chat UIs')
  })

  it('运行中给「正在联网搜索」，不算条数', function () {
    renderCard(makeProps({ result: undefined, status: { type: 'running' } }))
    expect(screen.getByText('正在联网搜索')).toBeInTheDocument()
    expect(screen.queryByText(/读取 \d+ 个来源/)).toBeNull()
  })

  it('结果里编码过的 JSON 也能拆出标题', function () {
    renderCard(
      makeProps({
        result: JSON.stringify({
          results: [{ title: 'Encoded source', url: 'https://example.com/a' }]
        })
      })
    )
    expect(screen.getByText('Encoded source')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('只有文本时退回 markdown 链接，标题不是整条 URL', function () {
    renderCard(
      makeProps({
        result: undefined,
        outputText:
          '1. [Persisting composer state](https://assistant-ui.com/docs/draft)\n2. https://react.dev/x'
      })
    )
    expect(screen.getByText('Persisting composer state')).toBeInTheDocument()
    expect(screen.getByText('react.dev')).toBeInTheDocument()
  })

  it('原始结果默认折叠，点开才出现', function () {
    const raw =
      '{"results":[{"title":"Persisting composer state across threads","url":"https://assistant-ui.com/a"}]}'
    const { container } = renderCard(makeProps({ result: STRUCTURED, outputText: raw }))
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByText('原始结果'))
    expect(container.querySelector('pre')?.textContent).toBe(raw)
  })
})
