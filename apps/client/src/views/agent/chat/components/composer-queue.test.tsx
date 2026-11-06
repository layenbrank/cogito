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

/** 记录 `aui.composer.queueItem(id).move(placement)`，用于验证「上移/下移」到底怎么挪的 */
const moveCalls = [] as { id: string; placement: Record<string, unknown> }[]
/** 返回 true 表示这次 move 被库拒（锚点不在该 lane）；测试用它模拟跨 lane */
let rejectMove: ((placement: Record<string, unknown>) => boolean) | null = null

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
          queueItem: function (input: { id: string }) {
            return {
              remove: vi.fn(),
              move: vi.fn(function (placement: Record<string, unknown>) {
                moveCalls.push({ id: input.id, placement })
                if (rejectMove?.(placement)) {
                  // 与真身同一口径：锚点必须在目标 lane 里，否则抛
                  const lane = typeof placement.lane === 'string' ? placement.lane : 'item-lane'
                  const anchor = String(placement.insertBefore ?? placement.insertAfter)
                  throw new Error(`Unknown anchor "${anchor}" in lane "${lane}".`)
                }
              })
            }
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
        queueRemoveItem: function () {
          return 'Remove from queue'
        },
        queueSteerNow: 'Send now',
        queueStopHint: 'Stopping ends this run only',
        queuedMessages: function (count: number) {
          return `${count} queued`
        },
        queueExpand: '展开队列',
        queueCollapse: '收起队列',
        queueEmptyPreview: '（无文本）',
        queueTakeBack: '取回编辑',
        queueMoveUp: '上移',
        queueMoveDown: '下移',
        queuePendingHeading: function (count: number) {
          return `上次没发出去的（${count}）`
        },
        queuePendingSend: '发送这条',
        queuePendingDrop: '丢弃',
        queueLines: function (count: number) {
          return `⏎ ${count} 行`
        }
      }
    }
  }
})

vi.mock('@cogito/design/assistant/tooltip-icon-button', function () {
  return {
    TooltipIconButton: function StubIconButton(props: {
      tooltip: string
      children?: ReactNode
      onClick?: () => void
      disabled?: boolean
    }) {
      return (
        <button
          type="button"
          aria-label={props.tooltip}
          disabled={props.disabled}
          onClick={props.onClick}>
          {props.children}
        </button>
      )
    }
  }
})

vi.mock('@cogito/design/assistant/composer-chip-text', function () {
  return {
    // 与真身同一契约：singleLine 时换行折成空格（队列侧三处都必须传 true）
    ComposerChipText: function StubChipText(props: { text: string; singleLine?: boolean }) {
      const text = props.singleLine ? props.text.replace(/\r\n|\r|\n/g, ' ') : props.text
      return (
        <span data-single-line={props.singleLine ? 'true' : undefined}>{text}</span>
      )
    },
    resolveComposerChipLabel: function () {
      return ''
    },
    // design 内部（message-queue）也会 import 同一模块：按真实口径给上，否则计数调用会拿到 undefined
    countComposerLines: function (text: string) {
      return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length
    }
  }
})

vi.mock('@/features/agent/composer-queue', function () {
  return {
    dropPendingItem: vi.fn(),
    sendPendingItem: vi.fn(),
    // 自走泵与顺序调整：面板会在 effect / 按钮里调用它们
    markThreadRunning: vi.fn(),
    pumpPendingQueue: vi.fn(),
    movePendingItem: vi.fn(),
    persistComposerQueue: vi.fn(function () {
      return Promise.resolve()
    }),
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

vi.mock('sonner', function () {
  return {
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
  }
})

import { ComposerQueue } from './composer-queue'
import { toast } from 'sonner'
import {
  markThreadRunning,
  movePendingItem,
  persistComposerQueue
} from '@/features/agent/composer-queue'

function queueItem(id: string, text: string) {
  return { id, parts: [{ type: 'text', text }] }
}

describe('composer 队列面板', function () {
  beforeEach(function () {
    queueState.composer.queue = []
    pendingState.items = []
    queueState.thread.isRunning = true
    moveCalls.length = 0
    rejectMove = null
    vi.clearAllMocks()
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

  it('多行条目：折叠头也是一行，并给出「⏎ N 行」标记与全文 title', function () {
    const multiline = '第一行\n第二行\n第三行\n第四行'
    queueState.composer.queue = [queueItem('q1', multiline)]
    const { container } = render(<ComposerQueue />)

    const header = container.querySelector('[data-slot="message-queue-header"]')
    expect(header).not.toBeNull()
    // 真的只有一行：没有 <br>，可见文本里没有换行
    expect(header?.querySelector('br')).toBeNull()
    expect(header?.textContent ?? '').not.toContain('\n')
    expect(header?.querySelector('[data-single-line="true"]')).not.toBeNull()
    // 单行预览背后还有内容的提示
    expect(screen.getByText('⏎ 4 行')).toBeInTheDocument()
    // 全文仍在 title 里
    expect(header?.querySelector('[title]')?.getAttribute('title')).toBe(multiline)
  })

  it('展开后列表封顶并可滚动，每条只占一行，且带「立即发 / 删除」', function () {
    const multiline = '第一条\n第二条\n第三条'
    queueState.composer.queue = [queueItem('q1', multiline), queueItem('q2', '第二条')]
    const { container } = render(<ComposerQueue />)

    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const body = container.querySelector('[data-slot="message-queue-body"]')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('max-h-[min(11rem,32vh)]')
    expect(body?.className).toContain('overflow-y-auto')

    const rows = container.querySelectorAll('[data-slot="message-queue-item"]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      // 单行：truncate + 固定行高，不靠 line-clamp 撑高
      expect(row.querySelector('.truncate')).not.toBeNull()
      expect(row.querySelector('br')).toBeNull()
      expect(row.textContent ?? '').not.toContain('\n')
      expect(row.className).toContain('items-center')
      expect(row.className).toContain('leading-5')
    }
    // 多行条目标了行数，单行条目不标
    expect(rows[0].querySelector('[data-slot="message-queue-item-lines"]')?.textContent).toBe('⏎ 3 行')
    expect(rows[1].querySelector('[data-slot="message-queue-item-lines"]')).toBeNull()

    // assistant-ui 元素自带的行内动作：立即发 / 删除
    expect(screen.getAllByRole('button', { name: 'Send now' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Remove from queue' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: '收起队列' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('待发送条目并入同一个可折叠区，条数一起算，且同样单行', function () {
    pendingState.items = [{ id: 'p1', text: '上次没发出去的\n第二行', attachments: '[]' }]
    const { container } = render(<ComposerQueue />)

    expect(screen.getByText('1 queued')).toBeInTheDocument()
    // 队列为空时折叠态的预览取「上次没发出去的」第一条
    expect(screen.getByText('上次没发出去的 第二行')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const pending = container.querySelector('[data-slot="message-queue-pending"]')
    expect(pending).not.toBeNull()
    expect(pending?.querySelector('.truncate')).not.toBeNull()
    const row = container.querySelector('[data-slot="message-queue-pending-item"]')
    expect(row?.querySelector('br')).toBeNull()
    expect(row?.textContent ?? '').not.toContain('\n')
    expect(row?.querySelector('[data-single-line="true"]')).not.toBeNull()
    expect(row?.querySelector('[data-slot="message-queue-item-lines"]')?.textContent).toBe('⏎ 2 行')
  })

  it('取回编辑：文本并回输入框，并把焦点交回编辑器', function () {
    queueState.composer.queue = [queueItem('q1', '排队中的消息')]
    // 真身按类名找当前挂载的编辑器：这里摆一个同类占位，验证焦点真的回去了
    const input = document.createElement('div')
    input.className = 'aui-composer-input'
    input.tabIndex = 0
    document.body.appendChild(input)

    render(<ComposerQueue />)
    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))
    fireEvent.click(screen.getByRole('button', { name: '取回编辑' }))

    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('运行中通知自走泵，轮次结束后由它补发待发送队列', function () {
    pendingState.items = [{ id: 'p1', text: '之前没发出去的', attachments: '[]' }]
    render(<ComposerQueue />)
    // 线程在跑：只登记，不许抢在轮次中间发
    expect(vi.mocked(markThreadRunning)).toHaveBeenCalledWith('session-1')
  })

  it('上移 / 下移不写死 lane：锚点交给库按条目自己的 lane 解析', function () {
    queueState.composer.queue = [queueItem('q1', '第一条'), queueItem('q2', '第二条')]
    const { container } = render(<ComposerQueue />)
    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))
    const rows = container.querySelectorAll('[data-slot="message-queue-item"]')

    fireEvent.click(rows[1].querySelector('[aria-label="上移"]') as HTMLElement)
    // 不带 lane：运行中排队消息都在 steer lane，写死 queue 就会抛 Unknown anchor
    expect(moveCalls).toEqual([{ id: 'q2', placement: { insertBefore: 'q1' } }])

    moveCalls.length = 0
    fireEvent.click(rows[0].querySelector('[aria-label="下移"]') as HTMLElement)
    expect(moveCalls).toEqual([{ id: 'q1', placement: { insertAfter: 'q2' } }])
  })

  it('lane 不匹配时自动换另一条 lane 重试（跨 steer/queue 交界也能调序）', function () {
    queueState.composer.queue = [queueItem('q1', '第一条'), queueItem('q2', '第二条')]
    // 模拟两条都在 steer lane：不指定 lane 与指定 queue 都找不到锚点，只有 steer 命中
    rejectMove = function (placement) {
      return placement.lane !== 'steer'
    }
    const { container } = render(<ComposerQueue />)
    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))
    const rows = container.querySelectorAll('[data-slot="message-queue-item"]')

    fireEvent.click(rows[1].querySelector('[aria-label="上移"]') as HTMLElement)

    expect(moveCalls.map((call) => call.placement)).toEqual([
      { insertBefore: 'q1' },
      { lane: 'steer', insertBefore: 'q1' }
    ])
    // 第二次成了：不该给用户报错
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
  })

  it('两条 lane 都被拒时给一句提示，不再静默失败', function () {
    queueState.composer.queue = [queueItem('q1', '第一条'), queueItem('q2', '第二条')]
    rejectMove = function () {
      return true
    }
    const { container } = render(<ComposerQueue />)
    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))
    const rows = container.querySelectorAll('[data-slot="message-queue-item"]')

    fireEvent.click(rows[0].querySelector('[aria-label="下移"]') as HTMLElement)

    expect(moveCalls).toHaveLength(3)
    expect(vi.mocked(toast.error)).toHaveBeenCalled()
  })

  it('待发送条目可上移 / 下移，移动成功后立刻落库', function () {
    queueState.thread.isRunning = false
    pendingState.items = [
      { id: 'p1', text: '第一条', attachments: '[]' },
      { id: 'p2', text: '第二条', attachments: '[]' }
    ]
    vi.mocked(movePendingItem).mockReturnValue(true)

    const { container } = render(<ComposerQueue />)
    fireEvent.click(screen.getByRole('button', { name: '展开队列' }))

    const rows = container.querySelectorAll('[data-slot="message-queue-pending-item"]')
    expect(rows).toHaveLength(2)
    // 首条不能上移、末条不能下移
    expect((rows[0].querySelector('[aria-label="上移"]') as HTMLButtonElement).disabled).toBe(true)
    expect((rows[1].querySelector('[aria-label="下移"]') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(rows[0].querySelector('[aria-label="下移"]') as HTMLElement)
    expect(vi.mocked(movePendingItem)).toHaveBeenCalledWith('session-1', 'p1', 1)
    // 顺序就是队列语义：换位后必须立刻写回，不能等「下次队列变化」
    expect(vi.mocked(persistComposerQueue)).toHaveBeenCalled()
  })
})
