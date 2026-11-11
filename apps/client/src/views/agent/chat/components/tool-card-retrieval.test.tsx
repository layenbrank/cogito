import '@testing-library/jest-dom/vitest'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'
import { ToolCardRetrieval } from '@/views/agent/chat/components/tool-card-retrieval'

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
    toolCallId: 'call-retrieval-1',
    toolName: 'app_knowledge_search',
    args: { query: '发布前检查' },
    argsText: '{"query":"发布前检查"}',
    status: { type: 'complete' },
    outputText: '',
    ...overrides
  } as unknown as CardProps
}

function renderCard(props: CardProps) {
  return render(
    <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
      <ToolCardRetrieval {...props} />
    </AssistantLabelsProvider>
  )
}

const FTS = {
  mode: 'fts',
  channels: ['fts'],
  vectorEnabled: false,
  hits: [
    {
      docId: 'd1',
      baseId: 'b1',
      title: '发布契约',
      relPath: 'wiki/publish.md',
      snippet: '发布前先跑 pnpm check，确认契约生成物没有漂移。',
      score: -3.2,
      mode: 'fts'
    },
    {
      docId: 'd2',
      baseId: 'b1',
      title: '会议纪要',
      relPath: 'wiki/meeting.md',
      snippet: '讨论了知识库发布流程。',
      score: -1.4,
      mode: 'fts'
    }
  ]
}

describe('检索块卡', function () {
  it('查询词进药丸，命中逐条列出标题、路径与相对分数', function () {
    const { container } = renderCard(makeProps({ result: FTS }))
    expect(container.querySelector('[data-slot="retrieval-chunks"]')).not.toBeNull()
    expect(screen.getByText('发布前检查')).toBeInTheDocument()
    expect(screen.getByText('发布契约')).toBeInTheDocument()
    expect(screen.getByText('2 段命中')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="retrieval-chunk"]')).toHaveLength(2)
    expect(screen.getByText('wiki/publish.md')).toBeInTheDocument()
    // bm25 最相关的记 1.00，其余按分数差折算
    expect(screen.getByText('1.00')).toBeInTheDocument()
    expect(screen.getByText('0.50')).toBeInTheDocument()
  })

  it('不再把整块 JSON 当正文', function () {
    const { container } = renderCard(makeProps({ result: FTS, outputText: JSON.stringify(FTS) }))
    expect(container.textContent).not.toContain('"vectorEnabled"')
  })

  it('短词回退（like）没有可信分数：只给「模糊」，不画分数条', function () {
    const { container } = renderCard(
      makeProps({
        result: {
          mode: 'like',
          hits: [
            {
              docId: 'd3',
              title: '会议纪要',
              relPath: 'wiki/meeting.md',
              snippet: '讨论了知识库方案。',
              score: 0,
              mode: 'like'
            }
          ]
        }
      })
    )
    expect(screen.getByText('模糊')).toBeInTheDocument()
    expect(container.querySelector('[role="meter"]')).toBeNull()
  })

  it('运行中给「正在检索知识库」', function () {
    renderCard(makeProps({ result: undefined, status: { type: 'running' } }))
    expect(screen.getByText('正在检索知识库')).toBeInTheDocument()
    expect(screen.queryByText(/段命中/)).toBeNull()
  })

  it('编码过的 JSON 字符串也能拆出命中', function () {
    renderCard(makeProps({ result: JSON.stringify(FTS) }))
    expect(screen.getByText('发布契约')).toBeInTheDocument()
    expect(screen.getByText('wiki/publish.md')).toBeInTheDocument()
  })

  it('原始结果默认折叠，点开才出现', function () {
    const raw = JSON.stringify(FTS)
    const { container } = renderCard(makeProps({ result: FTS, outputText: raw }))
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByText('原始结果'))
    expect(container.querySelector('pre')?.textContent).toBe(raw)
  })
})
