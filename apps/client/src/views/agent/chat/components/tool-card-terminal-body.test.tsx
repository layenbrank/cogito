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

describe('长任务形态（job-progress）', function () {
  // 后台命令没有可预期的结束点，直接走任务卡；前台命令的 20s 阈值见
  // tool-card-job-state.test.ts（耗时来自 hook，测试环境拿不到）
  const DEV = { command: 'npm run dev', background: true }

  it('后台命令升级成任务进度卡，不再是终端条', function () {
    const { container } = render(<ToolCardTerminalBody {...makeProps({ args: DEV })} />)
    const card = container.querySelector('[data-slot="job-progress"]')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('data-state')).toBe('running')
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
    // 原始输出没丢，折在「输出」里
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="terminal"]')).toBeNull()
  })

  it('跑完的命令给收据，且不再给取消按钮', function () {
    const { container } = render(
      <ToolCardTerminalBody
        {...makeProps({ args: DEV, status: { type: 'complete' }, outputText: 'ready in 812ms' })}
      />
    )
    expect(container.querySelector('[data-slot="job-progress"]')?.getAttribute('data-state')).toBe(
      'success'
    )
    expect(
      container.querySelector('[data-slot="job-progress-bar"]')?.getAttribute('aria-valuenow')
    ).toBe('100')
    expect(screen.queryByLabelText('Cancel the job')).toBeNull()
  })

  it('失败的命令同样给收据，结局靠收据而不是进度数字表达', function () {
    const { container } = render(
      <ToolCardTerminalBody
        {...makeProps({
          args: DEV,
          status: { type: 'incomplete', reason: 'error' },
          isError: true
        })}
      />
    )
    expect(container.querySelector('[data-slot="job-progress"]')?.getAttribute('data-state')).toBe(
      'failed'
    )
    // 命令本身跑完了（进程正常退出，只是退出码非 0）：条走到头，结局用红色收据表达
    expect(
      container.querySelector('[data-slot="job-progress-bar"]')?.getAttribute('aria-valuenow')
    ).toBe('100')
  })
})
