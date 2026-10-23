// @vitest-environment jsdom
import { type AssistantClient, useAui, useAuiState } from '@assistant-ui/react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 会话装配的端到端回归：挂真的 `ChatRuntimeProvider`，只把两个端口换成假的。
 *
 * 这里的断言全是"曾经真的坏过"的点：
 * - 新建会话发消息时，历史写入必须带**落库后的会话 id**（拿不到就是外键失败 +
 *   assistant-ui 静默吞掉 → 消息凭空消失）
 * - 运行请求里的 `host.sessionID` 必须与历史写入同一个 id（主进程按它记
 *   `studio 线程 → opencode 会话` 映射、记用量）
 * - 点开左侧会话必须按**它的** id 去读历史（读不到就永远是空白）
 * - 新建会话的**工作区归属**必须发回列表项：左栏按 `custom.workspaceID` 分组，而库
 *   `initialize()` 只回 remoteId，不回 `createThread` 的 custom（不发就是「未关联工作区」）
 *
 * 造这些断言的原因是：上面两条链的失败在界面上都表现为"没反应"，没有日志就走不出迷雾。
 */

const fake = vi.hoisted(function () {
  return {
    threads: [] as Array<{
      id: string
      title: string
      pinned: boolean
      updatedAt: number
      providerID: string | null
      workspaceID: string | null
    }>,
    rows: [] as Array<{
      threadID: string
      id: string
      parentID: string | null
      format: string
      content: string
    }>,
    loadedThreads: [] as string[],
    appended: [] as Array<{ threadID: string; id: string }>,
    createdThreads: 0,
    runHosts: [] as Array<Record<string, unknown>>,
    /** 用例自定义这一轮的事件流；留空就用默认的「收到」 */
    events: [] as Array<Record<string, unknown>>
  }
})

// jsdom 缺两样会话视口要用的浏览器 API（测高度、自动滚到底）。存根掉即可 ——
// 排版断言不看尺寸，也不关心滚动
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never)
Element.prototype.scrollTo = Element.prototype.scrollTo ?? function () {}

vi.mock('@/features/chat/port/history.ts', function () {
  return {
    createHistoryPort: function () {
      return {
        async findThreads() {
          return fake.threads
        },
        async findThread(id: string) {
          return (
            fake.threads.find(function (row) {
              return row.id === id
            }) ?? null
          )
        },
        async createThread(input?: { title?: string; workspaceID?: string | null }) {
          fake.createdThreads += 1
          const thread = {
            id: `db-session-${fake.createdThreads}`,
            title: input?.title ?? '新会话',
            pinned: false,
            updatedAt: Date.now(),
            providerID: null,
            // 与真实端口同形：调用方没点名工作区时落到「当前工作区」
            workspaceID: input?.workspaceID ?? 'ws-A'
          }
          fake.threads.push(thread)
          return thread
        },
        async updateThread(id: string, patch: { title?: string; workspaceID?: string | null }) {
          const thread = fake.threads.find(function (row) {
            return row.id === id
          })
          if (!thread) throw new Error('会话不存在')
          Object.assign(thread, patch)
          return thread
        },
        async deleteThread(id: string) {
          fake.threads = fake.threads.filter(function (row) {
            return row.id !== id
          })
        },
        async findMessages(input: { threadID: string }) {
          fake.loadedThreads.push(input.threadID)
          return fake.rows
            .filter(function (row) {
              return row.threadID === input.threadID
            })
            .map(function (row) {
              return {
                id: row.id,
                parentID: row.parentID,
                format: row.format,
                content: row.content
              }
            })
        },
        async appendMessage(input: {
          threadID: string
          id: string
          parentID: string | null
          format: string
          content: string
        }) {
          fake.appended.push({ threadID: input.threadID, id: input.id })
          fake.rows.push({ ...input })
        },
        async updateMessage() {},
        async deleteMessages() {}
      }
    }
  }
})

vi.mock('@/features/chat/port/instance.ts', function () {
  return {
    chatModelPort: {
      async findTarget() {
        return { providerID: 'fake-provider', model: 'fake-model' }
      },
      async *run(input: { host?: Record<string, unknown> }) {
        fake.runHosts.push(input.host ?? {})
        if (fake.events.length > 0) {
          for (const event of fake.events) yield event as never
          return
        }
        yield { kind: 'text', blockID: 'b1', text: '收到' }
        yield { kind: 'finish', finishReason: 'stop', usage: { totalTokens: 1 } }
      },
      respondToApproval() {
        return true
      }
    },
    /** 与真实实现同形：会话 id 由调用方给出，原样带进 `host` */
    findHostOptions(_target: unknown, sessionID: string) {
      return { supportsTools: true, approval: 'auto', workspaceID: 'ws-1', sessionID }
    }
  }
})

const { ChatRuntimeProvider } = await import('./runtime.tsx')
// 排版断言要挂真组件：`Thread` 是设计包渲染整条会话的入口，过程折叠也在它里面
const { Thread } = await import('@cogito/design/assistant/thread.aui')
const { AssistantLabelsProvider } = await import('@cogito/design/assistant/labels')
const { ASSISTANT_LABELS_ZH } = await import('./labels.ts')
const { AgentProcessFold } = await import('@/views/agent/chat/components/process-group.tsx')

/** 一条可被 `LOCAL_CODEC` 解出来的历史行（格式名与实现里的常量一致） */
function toStoredRow(threadID: string, id: string, text: string) {
  return {
    threadID,
    id,
    parentID: null,
    format: 'ith/thread-message-like',
    content: JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text }],
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
    })
  }
}

let client: AssistantClient | undefined

function Harness() {
  const aui = useAui()

  // 渲染期不写外部变量：句柄在 effect 里交给用例
  useEffect(
    function () {
      client = aui
    },
    [aui]
  )

  const items = useAuiState(function (state) {
    return state.threads.threadItems
  })
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  return (
    <div>
      <ul data-testid="threads">
        {items.map(function (item) {
          return (
            <li
              key={item.id}
              data-remote={item.remoteId ?? ''}
              data-thread={item.id}
              data-workspace={
                typeof item.custom?.workspaceID === 'string' ? item.custom.workspaceID : ''
              }>
              {item.title}
            </li>
          )
        })}
      </ul>
      <div data-testid="messages">
        {messages.map(function (message) {
          const text = message.content
            .filter(function (part) {
              return part.type === 'text'
            })
            .map(function (part) {
              return part.type === 'text' ? part.text : ''
            })
            .join('')
          return <p key={message.id}>{text}</p>
        })}
      </div>
    </div>
  )
}

// vitest 没开 `globals`，RTL 的自动清理挂不上：不手动清，上一个用例的 DOM 会留在页面里
afterEach(cleanup)

// 每个用例都要自己造现场：`fake` 与模块级 `historyPort` 是跨用例共享的
beforeEach(function () {
  fake.threads.length = 0
  fake.rows.length = 0
  fake.loadedThreads.length = 0
  fake.appended.length = 0
  fake.runHosts.length = 0
  fake.createdThreads = 0
  fake.events.length = 0
})

describe('会话装配（runtime）', function () {
  it('新建会话发消息：历史写入与运行请求都带落库后的会话 id', async function () {
    render(
      <ChatRuntimeProvider>
        <Harness />
      </ChatRuntimeProvider>
    )

    await waitFor(function () {
      expect(client).toBeDefined()
    })

    await act(async function () {
      await client!.thread().append({ role: 'user', content: [{ type: 'text', text: '测试' }] })
    })

    await waitFor(function () {
      expect(fake.appended.length).toBeGreaterThan(0)
    })

    const threadID = fake.appended[0].threadID
    expect(threadID).toBeTruthy()
    expect(threadID).toBe(`db-session-${fake.createdThreads}`)
    expect(
      fake.appended.every(function (row) {
        return row.threadID === threadID
      })
    ).toBe(true)

    await waitFor(function () {
      expect(fake.runHosts.length).toBeGreaterThan(0)
    })
    expect(fake.runHosts[0].sessionID).toBe(threadID)
  })

  it('本次新建的会话：发完消息再切回来，历史照样渲染（从侧栏点回原会话）', async function () {
    render(
      <ChatRuntimeProvider>
        <Harness />
      </ChatRuntimeProvider>
    )

    await waitFor(function () {
      expect(client).toBeDefined()
    })

    await act(async function () {
      await client!.thread().append({
        role: 'user',
        content: [{ type: 'text', text: '第一条消息' }]
      })
    })
    await waitFor(function () {
      expect(fake.appended.length).toBeGreaterThan(0)
    })

    const createdID = fake.appended[0].threadID
    expect(createdID).toBe(`db-session-${fake.createdThreads}`)

    // 再开一个会话、然后切回刚才那个 —— 这正是「点开左侧会话一片空白」的操作序列：
    // 身份若只认那份可能过期的列表项快照，切回来就会读成空历史
    await act(async function () {
      void client!.threads.switchToNewThread()
    })
    await act(async function () {
      void client!.threads.switchToThread(createdID)
    })

    // 会话标题就是首条消息的截断，所以只能在消息区里找（侧栏那份是标题）
    const pane = screen.getByTestId('messages')
    await waitFor(function () {
      expect(within(pane).getByText('第一条消息')).toBeTruthy()
    })
  })

  it('新建会话：落库拿到的归属要发回列表项（左栏据此分组）', async function () {
    render(
      <ChatRuntimeProvider>
        <Harness />
      </ChatRuntimeProvider>
    )

    await waitFor(function () {
      expect(client).toBeDefined()
    })

    await act(async function () {
      await client!.thread().append({ role: 'user', content: [{ type: 'text', text: '归属' }] })
    })
    await waitFor(function () {
      expect(fake.appended.length).toBeGreaterThan(0)
    })

    function row() {
      return screen.getByTestId('threads').querySelector('li[data-remote]') as HTMLElement | null
    }

    // 归属来自落库的那一行（`createThread` 落的 'ws-A'），不是列表重载后才补上
    await waitFor(function () {
      expect(row()?.getAttribute('data-workspace')).toBe('ws-A')
    })
  })

  it('点开已有会话：按它的会话 id 读历史并渲染出来', async function () {
    const thread = {
      id: 'db-session-old',
      title: '旧会话',
      pinned: false,
      updatedAt: Date.now(),
      providerID: null,
      workspaceID: null
    }
    fake.threads.push(thread)
    fake.rows.push(toStoredRow(thread.id, 'm1', '历史消息一'))

    render(
      <ChatRuntimeProvider>
        <Harness />
      </ChatRuntimeProvider>
    )

    await waitFor(function () {
      expect(screen.getByText('旧会话')).toBeTruthy()
    })

    const item = screen.getByText('旧会话').closest('li')!
    expect(item.getAttribute('data-remote')).toBe(thread.id)

    act(function () {
      void client!.threads.switchToThread(item.getAttribute('data-thread')!)
    })

    await waitFor(function () {
      expect(fake.loadedThreads).toContain(thread.id)
    })
    await waitFor(function () {
      expect(screen.getByText('历史消息一')).toBeTruthy()
    })
  })
})

/**
 * 一轮多步的排版：**[过程折叠区][最终回答]**。
 *
 * 断言的是"谁在折叠区里、谁留在外面"以及**顺序** —— 这两点都真的错过：聚合层曾经按类型
 * 归堆，把工具调用固定排在正文下方，看上去像"先给了结论才去读文件"。
 */
describe('对话排版（过程折叠）', function () {
  /** 句柄要在**这棵树里**取：模块级的 `client` 可能还是上一个用例留下的旧 runtime */
  function ThreadProbe() {
    const aui = useAui()

    useEffect(
      function () {
        client = aui
      },
      [aui]
    )

    return null
  }

  function foldRoot() {
    return document.querySelector('[data-slot="reasoning-root"]') as HTMLElement | null
  }

  /** 与 `chat.tsx` 同形的树：真 `Thread` + app 自己的过程折叠条 + 中文文案 */
  function renderThread() {
    render(
      <ChatRuntimeProvider>
        <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
          <ThreadProbe />
          <Thread components={{ ProcessGroup: AgentProcessFold }} />
        </AssistantLabelsProvider>
      </ChatRuntimeProvider>
    )
  }

  async function runTurn() {
    fake.events = [
      { kind: 'text', blockID: 't1', text: '我先读一下入口文件。' },
      { kind: 'tool-call', toolCallId: 'call-1', toolName: 'fs_read', input: { path: 'a.ts' } },
      { kind: 'tool-result', toolCallId: 'call-1', toolName: 'fs_read', output: 'ok' },
      { kind: 'text', blockID: 't2', text: '结论：入口在 main.ts。' },
      { kind: 'finish', finishReason: 'stop', usage: { totalTokens: 3 } }
    ]

    renderThread()

    await waitFor(function () {
      expect(client).toBeDefined()
    })

    await act(async function () {
      await client!.thread().append({
        role: 'user',
        content: [{ type: 'text', text: '看下入口文件' }]
      })
    })

    await waitFor(function () {
      expect(screen.getByText('结论：入口在 main.ts。')).toBeTruthy()
    })
  }

  it('过程收进折叠条：最终回答在外面，且排在它之后', async function () {
    await runTurn()

    const answer = screen.getByText('结论：入口在 main.ts。')
    const fold = foldRoot()

    expect(fold).toBeTruthy()
    // 结论**不在**过程区里（折叠条收起来的正是它上面那些过程内容）
    expect(fold!.contains(answer)).toBe(false)
    // 折叠区排在结论之前
    expect(fold!.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 回合结束就折叠（Copilot 的 CollapsedPreview 口径）
    const trigger = fold!.querySelector('[data-slot="reasoning-trigger"]')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('一次「思考 → 答」不加折叠区：只有思考自己那条，形状与改造前一致', async function () {
    fake.events = [
      { kind: 'reasoning', blockID: 'r1', text: '想想入口在哪。' },
      { kind: 'text', blockID: 't1', text: '入口在 main.ts。' },
      { kind: 'finish', finishReason: 'stop', usage: { totalTokens: 2 } }
    ]

    renderThread()

    await waitFor(function () {
      expect(client).toBeDefined()
    })
    await act(async function () {
      await client!.thread().append({
        role: 'user',
        content: [{ type: 'text', text: '入口在哪' }]
      })
    })
    await waitFor(function () {
      expect(screen.getByText('入口在 main.ts。')).toBeTruthy()
    })

    // 没有工具调用 → 不加外层「已处理」折叠条
    expect(screen.queryByText('已处理')).toBeNull()
    // 思考还是它自己那条折叠条
    expect(screen.getByText('思考')).toBeTruthy()
  })

  it('展开折叠条：思考 / 工具 / 中间解说都在里面，顺序不变', async function () {
    await runTurn()

    const trigger = foldRoot()!.querySelector('[data-slot="reasoning-trigger"]') as HTMLElement
    act(function () {
      trigger.click()
    })

    const fold = foldRoot()!
    await waitFor(function () {
      expect(fold.textContent).toContain('我先读一下入口文件。')
    })
    // 工具那段仍是一条折叠条（段内聚合没丢），条本身在过程区里
    const toolBar = fold.querySelector('[data-slot="tool-group-root"]')
    expect(toolBar).toBeTruthy()
    expect(toolBar!.textContent).toContain('1')
    // 中间解说 + 工具段按原时序排在折叠区里，结论不在
    expect(fold.textContent).not.toContain('结论：入口在 main.ts。')
    const narration = screen.getByText('我先读一下入口文件。')
    expect(
      narration.compareDocumentPosition(toolBar!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
