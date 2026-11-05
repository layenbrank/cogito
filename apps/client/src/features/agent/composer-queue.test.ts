import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

interface InvokePayload {
  params: {
    sessionID?: string
    lane?: string | null
    items?: { sessionID: string; lane: string; text: string; attachments: string }[]
  }
}

const { invokeMock } = vi.hoisted(function () {
  return {
    invokeMock: vi.fn(function (_command: string, _args: InvokePayload): Promise<unknown> {
      return Promise.resolve([])
    })
  }
})

vi.mock('@tauri-apps/api/core', function () {
  return { invoke: invokeMock }
})

import type { AssistantClient, QueueItemState } from '@assistant-ui/react'

import {
  QUEUE_DEBOUNCE_MS,
  dropPendingItem,
  persistComposerQueue,
  readComposerQueue,
  readPendingQueue,
  reconcileComposerQueue,
  replaceComposerQueue,
  resetComposerQueueState,
  sendPendingItem,
  subscribePendingQueue,
  textOfQueueItem
} from './composer-queue'

function row(id: string, text: string, sort: number) {
  return {
    id,
    sessionID: 's1',
    lane: 'main',
    sort,
    text,
    attachments: '[]',
    createdAt: 1,
    updatedAt: 1
  }
}

function queueItem(id: string, text: string): QueueItemState {
  return {
    id,
    prompt: text,
    parts: [{ type: 'text', text }]
  }
}

interface FakeAui {
  composer: {
    setText: Mock<(text: string) => void>
    send: ReturnType<typeof vi.fn>
    getState: () => { text: string }
  }
  thread: { getState: () => { isRunning: boolean } }
}

function makeAui(isRunning: boolean, draft = ''): FakeAui {
  return {
    composer: {
      setText: vi.fn<(text: string) => void>(),
      send: vi.fn(),
      getState: function () {
        return { text: draft }
      }
    },
    thread: {
      getState: function () {
        return { isRunning }
      }
    }
  }
}

function asAui(fake: FakeAui): AssistantClient {
  return fake as unknown as AssistantClient
}

/** 命令名 + 参数形状：这是 Rust 侧 serde 的唯一契约来源，类型检查抓不到拼写错误 */
describe('composer 队列：Tauri 命令契约', function () {
  beforeEach(function () {
    invokeMock.mockClear()
    invokeMock.mockImplementation(function () {
      return Promise.resolve([])
    })
    resetComposerQueueState()
  })

  it('toRead 用 agentComposerQueue:toRead，参数只带 sessionID', async function () {
    await readComposerQueue('s1')
    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [command, args] = invokeMock.mock.calls[0]
    expect(command).toBe('agentComposerQueue:toRead')
    expect(args).toEqual({ params: { sessionID: 's1' } })
  })

  it('toReplace 用 agentComposerQueue:toReplace，lane 传 null 表示整会话替换', async function () {
    await replaceComposerQueue('s1', [{ lane: 'main', text: '@a.ts', attachments: '[]' }])
    const [command, args] = invokeMock.mock.calls[0]
    expect(command).toBe('agentComposerQueue:toReplace')
    expect(args.params.sessionID).toBe('s1')
    expect(args.params.lane).toBeNull()
    expect(args.params.items).toEqual([
      { sessionID: 's1', lane: 'main', text: '@a.ts', attachments: '[]' }
    ])
  })

  it('toRead 返回非数组时按空队列处理（后端异常不该炸 UI）', async function () {
    invokeMock.mockImplementationOnce(function () {
      return Promise.resolve(null)
    })
    await expect(readComposerQueue('s1')).resolves.toEqual([])
  })

  it('debounce 窗口是 300ms', function () {
    expect(QUEUE_DEBOUNCE_MS).toBe(300)
  })
})

describe('composer 队列：条目 → 线格式文本', function () {
  it('多个 text part 直接拼接', function () {
    const item = {
      id: 'q1',
      prompt: '',
      parts: [
        { type: 'text', text: '看下 ' },
        { type: 'text', text: '@apps/a.ts' }
      ]
    } as QueueItemState
    expect(textOfQueueItem(item)).toBe('看下 @apps/a.ts')
  })

  it('附件 part 不进文本，但会被序列化进 attachments', async function () {
    const item = {
      id: 'q1',
      prompt: '',
      parts: [
        { type: 'text', text: '@apps/a.ts' },
        { type: 'file', filename: 'a.png', data: 'blob', mimeType: 'image/png' }
      ]
    } as unknown as QueueItemState
    expect(textOfQueueItem(item)).toBe('@apps/a.ts')
    await replaceComposerQueue('s1', [
      { lane: 'main', text: textOfQueueItem(item), attachments: '[]' }
    ])
    const [, args] = invokeMock.mock.calls.at(-1) as [string, InvokePayload]
    expect(args.params.items?.[0]?.text).toBe('@apps/a.ts')
  })
})

describe('composer 队列：回灌与待发送', function () {
  beforeEach(function () {
    invokeMock.mockClear()
    resetComposerQueueState()
  })

  it('会话仍在运行：逐条 setText + send({steer:false})，不留待发送', async function () {
    invokeMock.mockImplementation(function () {
      return Promise.resolve([row('r1', '第一条', 0), row('r2', '@apps/a.ts', 1)])
    })
    const aui = makeAui(true)

    await reconcileComposerQueue(asAui(aui), 's1', { isRunning: true })

    expect(aui.composer.setText.mock.calls.map(function (call) { return call[0] })).toEqual([
      '第一条',
      '@apps/a.ts'
    ])
    expect(aui.composer.send.mock.calls).toEqual([[{ steer: false }], [{ steer: false }]])
    expect(readPendingQueue('s1')).toEqual([])
  })

  it('会话已结束：进待发送列表，不自动发送', async function () {
    invokeMock.mockImplementation(function () {
      return Promise.resolve([row('r1', '第一条', 0), row('r2', '第二条', 1)])
    })
    const aui = makeAui(false)
    const listener = vi.fn()
    const unsubscribe = subscribePendingQueue(listener)

    await reconcileComposerQueue(asAui(aui), 's1', { isRunning: false })

    expect(aui.composer.send).not.toHaveBeenCalled()
    expect(readPendingQueue('s1').map(function (item) { return item.text })).toEqual([
      '第一条',
      '第二条'
    ])
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('同一会话只回灌一次（严格模式双挂载不会灌两遍）', async function () {
    invokeMock.mockImplementation(function () {
      return Promise.resolve([row('r1', '第一条', 0)])
    })
    const aui = makeAui(true)

    await Promise.all([
      reconcileComposerQueue(asAui(aui), 's1', { isRunning: true }),
      reconcileComposerQueue(asAui(aui), 's1', { isRunning: true })
    ])
    await reconcileComposerQueue(asAui(aui), 's1', { isRunning: true })

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(aui.composer.send).toHaveBeenCalledTimes(1)
  })

  it('库里没有行时直接放行落库（不用再等 reconcile）', async function () {
    invokeMock.mockImplementationOnce(function () {
      return Promise.resolve([])
    })
    await reconcileComposerQueue(asAui(makeAui(true)), 's1', { isRunning: true })
    expect(readPendingQueue('s1')).toEqual([])
  })

  it('落库负载 = 队列 + 待发送（待发送排在后面，顺序即数组顺序）', async function () {
    invokeMock.mockImplementationOnce(function () {
      return Promise.resolve([row('r1', '待发送 A', 0)])
    })
    await reconcileComposerQueue(asAui(makeAui(false)), 's1', { isRunning: false })

    invokeMock.mockClear()
    invokeMock.mockImplementation(function () {
      return Promise.resolve([])
    })
    await persistComposerQueue('s1', [queueItem('q1', '队列里的'), queueItem('q2', '队列第二条')])

    const [, args] = invokeMock.mock.calls[0]
    expect(args.params.items?.map(function (item) { return item.text })).toEqual([
      '队列里的',
      '队列第二条',
      '待发送 A'
    ])
  })

  it('发送待发送条目：出列表 + 回输入框 + 立即发送', async function () {
    invokeMock.mockImplementation(function () {
      return Promise.resolve([row('r1', '第一条', 0), row('r2', '第二条', 1)])
    })
    const aui = makeAui(false)
    await reconcileComposerQueue(asAui(aui), 's1', { isRunning: false })

    sendPendingItem(asAui(aui), 's1', 'r1')

    expect(aui.composer.setText).toHaveBeenCalledWith('第一条')
    expect(aui.composer.send).toHaveBeenCalledTimes(1)
    expect(readPendingQueue('s1').map(function (item) { return item.id })).toEqual(['r2'])
  })

  it('丢弃待发送条目只删列表，不动输入框', async function () {
    invokeMock.mockImplementation(function () {
      return Promise.resolve([row('r1', '第一条', 0)])
    })
    const aui = makeAui(false)
    await reconcileComposerQueue(asAui(aui), 's1', { isRunning: false })

    dropPendingItem('s1', 'r1')

    expect(readPendingQueue('s1')).toEqual([])
    expect(aui.composer.setText).not.toHaveBeenCalled()
    expect(aui.composer.send).not.toHaveBeenCalled()
  })

  it('不同会话的待发送互不干扰', async function () {
    invokeMock.mockImplementation(function (_command: string, args: InvokePayload) {
      if (args.params.sessionID === 's1') return Promise.resolve([row('r1', 's1 的', 0)])
      return Promise.resolve([row('r2', 's2 的', 0)])
    })
    await reconcileComposerQueue(asAui(makeAui(false)), 's1', { isRunning: false })
    await reconcileComposerQueue(asAui(makeAui(false)), 's2', { isRunning: false })

    expect(readPendingQueue('s1').map(function (item) { return item.text })).toEqual(['s1 的'])
    expect(readPendingQueue('s2').map(function (item) { return item.text })).toEqual(['s2 的'])
    expect(readPendingQueue(null)).toEqual([])
  })
})
