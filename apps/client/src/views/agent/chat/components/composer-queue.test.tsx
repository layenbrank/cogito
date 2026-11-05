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

type StubQueueItem = { id: string; parts: { type: string; text: string }[] }

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
    },
    ComposerPrimitive: {
      // 真身是 render-prop：按队列顺序逐条回调，这里保持同样的契约
      Queue: function StubQueue(props: {
        children: (value: { queueItem: StubQueueItem }) => ReactNode
      }) {
        return (
          <>
            {queueState.composer.queue.map(function (queueItem) {
              return (
                <div
                  key={queueItem.id}
                  data-stub-queue-item={queueItem.id}>
                  {props.children({ queueItem })}
                </div>
              )
            })}
          </>
        )
      }
    },
    QueueItemPrimitive: {
      Text: function StubQueueText() {
        return <span />
      },
      Steer: function StubQueueSteer(props: { children?: ReactNode }) {
        return <>{props.children}</>
      },
      Remove: function StubQueueRemove(props: { children?: ReactNode }) {
        return <>{props.children}</>
      }
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
        queueStopHint: 'Stopping ends this run only',
        queuedMessages: function (count: number) {
          return `${count} queued`
        },
        queueExpand: '展开队列',
        queueCollapse: '收起队列',
        queueEmptyPreview: '（无文本）'
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

  it('默认折叠：只给条数和第一条的一行预览', function () {
    queueState.composer.queue = [queueItem('q1', '第一条很长很长的排队消息'), queueItem('q2', '第二条')]
    const { container } = render(<ComposerQueue />)

    const toggle = screen.getByRole('button', { name: '展开队列' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('2 queued')).toBeInTheDocument()
    expect(screen.getByText('第一条很长很长的排队消息')).toBeInTheDocument()
    // 折叠态不渲染列表体：第二条完全看不到
    expect(screen.queryByText('第二条')).toBeNull()
    expect(container.querySelector('[data-slot="message-queue-body"]')).toBeNull()
  })

  it('展开后列表封顶并可滚动，每条只占一行，且带「立即发 / 删除」', function () {
    queueState.composer.queue = [queueItem('q1', '第一条'), queueItem('q2', '第二条')]
    const { container } = render(<ComposerQueue />)

    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const body = container.querySelector('[data-slot="message-queue-body"]')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('max-h-44')
    expect(body?.className).toContain('overflow-y-auto')

    const rows = container.querySelectorAll('[data-slot="message-queue-item"]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      // 单行：truncate + nowrap，不靠 line-clamp 撑高
      expect(row.querySelector('.truncate')).not.toBeNull()
      expect(row.className).toContain('items-center')
    }

    // assistant-ui 元素自带的行内动作：立即发 / 删除
    expect(screen.getAllByRole('button', { name: 'Send now' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Remove from queue' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: '收起队列' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('待发送条目并入同一个可折叠区，条数一起算', function () {
    pendingState.items = [{ id: 'p1', text: '上次没发出去的', attachments: '[]' }]
    const { container } = render(<ComposerQueue />)

    expect(screen.getByText('1 queued')).toBeInTheDocument()
    // 队列为空时折叠态的预览取「上次没发出去的」第一条
    expect(screen.getByText('上次没发出去的')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const pending = container.querySelector('[data-slot="message-queue-pending"]')
    expect(pending).not.toBeNull()
    expect(pending?.querySelector('.truncate')).not.toBeNull()
  })
})
