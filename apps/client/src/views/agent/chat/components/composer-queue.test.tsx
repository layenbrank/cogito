import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueState = {
  threads: {
    mainThreadId: 'thread-1',
    threadItems: [{ id: 'thread-1', remoteId: 'session-1' }]
  },
  composer: {
    queue: [] as { id: string; parts: { type: string; text: string }[] }[]
  },
  thread: { isRunning: true }
}

const pendingState = { items: [] as { id: string; text: string; attachments: string }[] }

vi.mock('@assistant-ui/react', function () {
  return {
    useAui: function () {
      return {
        thread: {
          getState: function () {
            return { isRunning: queueState.thread.isRunning }
          }
        },
        composer: {
          getState: function () {
            return { text: '' }
          },
          setText: vi.fn(),
          send: vi.fn(),
          queueItem: function () {
            return { remove: vi.fn(), move: vi.fn() }
          }
        }
      }
    },
    useAuiState: function (selector: (state: typeof queueState) => unknown) {
      return selector(queueState)
    }
  }
})

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

vi.mock('@cogito/design/assistant/labels', function () {
  return {
    useAssistantLabels: function () {
      return {
        queueHeading: 'Queued',
        queueRemove: 'Remove from queue',
        queueSteerNow: 'Send now',
        queueStopHint: 'Stopping ends this run only'
      }
    }
  }
})

vi.mock('@cogito/design/assistant/tooltip-icon-button', function () {
  return {
    TooltipIconButton: function StubIconButton(props: {
      tooltip: string
      children?: ReactNode
    }) {
      return (
        <button
          type="button"
          aria-label={props.tooltip}>
          {props.children}
        </button>
      )
    }
  }
})

vi.mock('@cogito/design/assistant/composer-chip-text', function () {
  return {
    ComposerChipText: function StubChipText(props: { text: string }) {
      return <span>{props.text}</span>
    },
    resolveComposerChipLabel: function () {
      return ''
    }
  }
})

vi.mock('@/features/agent/composer-queue', function () {
  return {
    dropPendingItem: vi.fn(),
    sendPendingItem: vi.fn(),
    reconcileComposerQueue: function () {
      return Promise.resolve()
    },
    readPendingQueue: function () {
      return pendingState.items
    },
    subscribePendingQueue: function () {
      return function () {}
    },
    textOfQueueItem: function (item: { parts?: { type: string; text: string }[] }) {
      return (item.parts ?? [])
        .filter(function (part) {
          return part.type === 'text'
        })
        .map(function (part) {
          return part.text
        })
        .join('')
    },
    useComposerQueuePersist: function () {}
  }
})

import { ComposerQueue } from './composer-queue'

function queueItem(id: string, text: string) {
  return { id, parts: [{ type: 'text', text }] }
}

describe('composer 队列面板', function () {
  beforeEach(function () {
    queueState.composer.queue = []
    pendingState.items = []
  })

  it('没有排队时什么都不渲染', function () {
    const { container } = render(<ComposerQueue />)
    expect(container.firstChild).toBeNull()
  })

  it('默认折叠：只给标题、条数和第一条的一行预览', function () {
    queueState.composer.queue = [queueItem('q1', '第一条很长很长的排队消息'), queueItem('q2', '第二条')]
    const { container } = render(<ComposerQueue />)

    const toggle = screen.getByRole('button', { name: '展开队列' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('第一条很长很长的排队消息')).toBeInTheDocument()
    // 折叠态不渲染列表体：第二条完全看不到
    expect(screen.queryByText('第二条')).toBeNull()
    expect(container.querySelector('[data-slot="cogito_composer-queue-body"]')).toBeNull()
  })

  it('展开后列表封顶并可滚动，每条只占一行', function () {
    queueState.composer.queue = [queueItem('q1', '第一条'), queueItem('q2', '第二条')]
    const { container } = render(<ComposerQueue />)

    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const body = container.querySelector('[data-slot="cogito_composer-queue-body"]')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('max-h-44')
    expect(body?.className).toContain('overflow-y-auto')

    const rows = container.querySelectorAll('[data-slot="cogito_composer-queue-item"]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      // 单行：truncate + nowrap，不靠 line-clamp 撑高
      expect(row.querySelector('.truncate')).not.toBeNull()
      expect(row.className).toContain('items-center')
    }
    expect(screen.getByRole('button', { name: '收起队列' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('待发送条目并入同一个列表，也各占一行', function () {
    pendingState.items = [{ id: 'p1', text: '上次没发出去的', attachments: '[]' }]
    const { container } = render(<ComposerQueue />)

    expect(screen.getByText('上次没发出去的')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const pendingRow = container.querySelector('[data-slot="cogito_composer-queue-pending"]')
    expect(pendingRow).not.toBeNull()
    expect(pendingRow?.querySelector('.truncate')).not.toBeNull()
  })
})
