import '@testing-library/jest-dom/vitest'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApprovalBar } from '@/views/agent/chat/components/tool-card-approval-bar'
import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'

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

const mocks = vi.hoisted(function () {
  return { respondToApproval: vi.fn(), success: vi.fn(), error: vi.fn() }
})

vi.mock('@/features/agent/port/instance', function () {
  return { chatModelPort: { respondToApproval: mocks.respondToApproval } }
})

vi.mock('sonner', function () {
  return { toast: { success: mocks.success, error: mocks.error } }
})

type BarProps = Pick<
  ToolCallMessagePartProps,
  'approval' | 'args' | 'result' | 'toolCallId' | 'toolName'
>

const THREE_OPTIONS = [
  { id: 'o-allow-once', kind: 'allow-once', label: '允许一次' },
  { id: 'o-allow-always', kind: 'allow-always', label: '始终允许' },
  { id: 'o-reject-once', kind: 'reject-once', label: '拒绝一次' }
]

function makeProps(overrides: Record<string, unknown> = {}): BarProps {
  return {
    toolCallId: 'call-shell-1',
    toolName: 'shell',
    args: { command: 'pnpm vitest run --changed' },
    approval: {
      prompt: 'The agent wants to run a shell command',
      options: THREE_OPTIONS
    },
    ...overrides
  } as unknown as BarProps
}

function renderBar(props: BarProps) {
  return render(
    <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
      <ApprovalBar {...props} />
    </AssistantLabelsProvider>
  )
}

beforeEach(function () {
  vi.clearAllMocks()
  mocks.respondToApproval.mockReturnValue(true)
})

describe('审批卡', function () {
  it('请求态：标题是工具名、prompt 当副标题、命令进等宽面板', function () {
    const { container } = renderBar(makeProps())
    expect(container.querySelector('[data-slot="approval-card"]')).not.toBeNull()
    expect(screen.getByText('执行命令')).toBeInTheDocument()
    expect(screen.getByText('The agent wants to run a shell command')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="approval-card-command"]')?.textContent).toBe(
      'pnpm vitest run --changed'
    )
    expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '始终允许' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝一次' })).toBeInTheDocument()
  })

  it('点「允许一次」：走 chatModelPort 并带上选中的 optionId', function () {
    renderBar(makeProps())
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    expect(mocks.respondToApproval).toHaveBeenCalledWith({
      toolCallId: 'call-shell-1',
      approved: true,
      optionId: 'o-allow-once'
    })
  })

  it('点「拒绝一次」：approved 是 false', function () {
    renderBar(makeProps())
    fireEvent.click(screen.getByRole('button', { name: '拒绝一次' }))
    expect(mocks.respondToApproval).toHaveBeenCalledWith({
      toolCallId: 'call-shell-1',
      approved: false,
      optionId: 'o-reject-once'
    })
  })

  it('两档拒绝都在：Deny 吃 reject-once，reject-always 插在它左边', function () {
    const { container } = renderBar(
      makeProps({
        approval: {
          prompt: '要执行这条命令吗',
          options: [
            ...THREE_OPTIONS,
            { id: 'o-reject-always', kind: 'reject-always', label: '总是拒绝' }
          ]
        }
      })
    )
    const slots = Array.from(container.querySelectorAll('[data-slot^="approval-card-"]')).map(
      function (node) {
        return node.getAttribute('data-slot')
      }
    )
    expect(slots.indexOf('approval-card-extra')).toBeGreaterThan(-1)
    expect(slots.indexOf('approval-card-extra')).toBeLessThan(slots.indexOf('approval-card-deny'))
    expect(screen.getByRole('button', { name: '总是拒绝' })).toBeInTheDocument()
  })

  it('一个档位都没声明：退回二元（拒绝 / 允许一次），不带 optionId', function () {
    const { container } = renderBar(makeProps({ approval: { prompt: '要执行这条命令吗' } }))
    expect(container.querySelectorAll('button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '始终允许' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    expect(mocks.respondToApproval).toHaveBeenCalledWith({
      toolCallId: 'call-shell-1',
      approved: true,
      optionId: undefined
    })
  })

  it('提交失效（票据已不在等待中）：提示重发，按钮恢复可用', function () {
    mocks.respondToApproval.mockReturnValue(false)
    renderBar(makeProps())
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    expect(mocks.error).toHaveBeenCalledWith('这次审批已经失效，请重新发送', { duration: 2000 })
    expect(screen.getByRole('button', { name: '允许一次' })).not.toBeDisabled()
  })

  it('已答复且结果到了：只剩收据，不重摆命令', function () {
    const { container } = renderBar(
      makeProps({ approval: { approved: true, prompt: '要执行这条命令吗' }, result: { ok: true } })
    )
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="approval-card-command"]')).toBeNull()
  })

  it('被取消按拒绝收尾', function () {
    renderBar(makeProps({ approval: { approved: false, resolution: 'cancelled' } }))
    expect(screen.getByText('已拒绝')).toBeInTheDocument()
  })

  it('没有审批通道的工具卡不占位', function () {
    const { container } = renderBar(makeProps({ approval: undefined }))
    expect(container.firstChild).toBeNull()
  })
})
