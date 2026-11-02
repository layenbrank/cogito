import '@testing-library/jest-dom/vitest'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ToolCardTerminalBody } from '@/views/agent/chat/components/tool-card-terminal-body'

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

function makeProps(overrides: Record<string, unknown> = {}): ToolCallMessagePartProps & {
  outputText: string
} {
  return {
    type: 'tool-call',
    toolCallId: 'call-1',
    toolName: 'shell',
    args: { command: 'npm test' },
    argsText: '{"command":"npm test"}',
    status: { type: 'running' },
    outputText: '',
    ...overrides
  } as unknown as ToolCallMessagePartProps & { outputText: string }
}

describe('命令类工具卡', function () {
  it('默认折叠：只给一行命令摘要，不渲染终端正文', function () {
    const { container } = render(<ToolCardTerminalBody {...makeProps()} />)
    expect(screen.getByText('npm test')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="terminal"]')).toBeNull()
  })

  it('点摘要行才展开终端正文', function () {
    const { container } = render(
      <ToolCardTerminalBody
        {...makeProps({ status: { type: 'complete' }, outputText: 'Tests 12 passed' })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /npm test/ }))
    expect(container.querySelector('[data-slot="terminal"]')).not.toBeNull()
    expect(screen.getByText(/Tests 12 passed/)).toBeInTheDocument()
  })

  it('没有命令参数时不渲染（交给其他卡片形态）', function () {
    const { container } = render(<ToolCardTerminalBody {...makeProps({ args: { path: 'a.ts' } })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
