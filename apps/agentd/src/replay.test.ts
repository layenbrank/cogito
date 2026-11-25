/**
 * 补历史（`POST /threads/:id/replay`）：goose `session/load` 重放 → `replay` 事件。
 *
 * 这条通道只在事件日志已淘汰（`sync.truncated`）时才用，因此它的正确性重点是**副作用边界**：
 * - 有活跃轮时必须拒绝（`session/load` 会把会话挂回连接，与 live 流交叉会乱序）；
 * - 只转发**本会话**的重放通知，且只留正文/推理/工具（用量那类是噪声）；
 * - 失败是旁路：`session/load` 报错只回 502 让客户端降级，不能污染任何正在跑的东西。
 */

import type { Server } from 'node:http'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { createEventHub } from './events'
import type { RunEvent } from './events'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []
const CWD = tmpdir()
const SESSION = 'session-replay'

interface Update {
  sessionUpdate: string
  messageId?: string
  content?: unknown
}

interface Harness {
  base: string
  events: RunEvent[]
}

function buildStatus(): AgentdStatus {
  return {
    service: SERVICE_NAME,
    version: 'test',
    uptimeMs: 1,
    pid: process.pid,
    graphs: ['agent'],
    goose: 'disabled',
    restarts: 0
  }
}

interface StubOptions {
  /** `session/load` 时「goose 推回来的」那批通知（`[sessionId, update]`） */
  updates?: Array<[string, Update]>
  /** 让 `session/load` 失败 */
  loadError?: string
  /** 图状态里有什么（决定「有没有会话可补」） */
  stateValues?: Record<string, unknown>
  /** 一轮要跑多久（0 = 不发 run） */
  runDelayMs?: number
}

async function startServer(options: StubOptions = {}): Promise<Harness> {
  const hub = createEventHub()
  const collected: RunEvent[] = []
  const listeners = new Set<(sessionId: string, update: unknown) => void>()
  const stateValues =
    options.stateValues ?? { sessionId: SESSION, cwd: CWD, mcpServers: [] }

  const agentServer = createAgentServer({
    graph: {
      stream: function () {
        return Promise.resolve(
          (async function* () {
            yield ['values', { step: 1 }]
            await new Promise<void>(function (resolve) {
              setTimeout(resolve, options.runDelayMs ?? 0)
            })
          })()
        )
      },
      getState: function () {
        return Promise.resolve({ values: stateValues })
      }
    } as never,
    events: hub,
    goose: {
      request: function (method: string) {
        if (method !== 'session/load') return Promise.resolve({})
        if (options.loadError) return Promise.reject(new Error(options.loadError))
        for (const [sessionId, update] of options.updates ?? []) {
          for (const listener of listeners) listener(sessionId, update)
        }
        return Promise.resolve({})
      },
      cancel: function () {
        return Promise.resolve()
      },
      onSessionUpdate: function (listener) {
        listeners.add(listener)
        return function () {
          listeners.delete(listener)
        }
      }
    }
  })

  const app = createApp({
    token: TOKEN,
    status: buildStatus,
    onShutdown: function () {},
    mount: function (target) {
      agentServer.mount(target)
    }
  })

  const base = await new Promise<string>(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      running.push(server)
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const original = hub.emit
      hub.emit = function (...args: Parameters<typeof original>) {
        const event = original.apply(hub, args)
        collected.push(event)
        return event
      }
      resolve(`http://127.0.0.1:${port}`)
    })
    server.on('error', reject)
  })

  return { base, events: collected }
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
}

async function createThread(base: string, threadID: string): Promise<void> {
  await fetch(`${base}/threads`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ thread_id: threadID })
  })
}

afterEach(async function () {
  const pending = running.splice(0)
  await Promise.all(
    pending.map(function (server) {
      return new Promise<void>(function (resolve) {
        server.close(function () {
          resolve()
        })
      })
    })
  )
})

describe('补历史：/threads/:id/replay', function () {
  it('把本会话的重放通知转成 replay 事件，噪声（用量/命令列表）丢掉', async function () {
    const harness = await startServer({
      updates: [
        [SESSION, { sessionUpdate: 'user_message_chunk', messageId: 'msg_1' }],
        [SESSION, { sessionUpdate: 'agent_message_chunk', messageId: 'a1' }],
        [SESSION, { sessionUpdate: 'tool_call', messageId: undefined }],
        // 噪声：不该进事件流
        [SESSION, { sessionUpdate: 'usage_update' }],
        [SESSION, { sessionUpdate: 'available_commands_update' }],
        // 别的会话：不该落到这个 thread
        ['other-session', { sessionUpdate: 'agent_message_chunk', messageId: 'b1' }]
      ]
    })
    await createThread(harness.base, 't-replay')

    const response = await fetch(`${harness.base}/threads/t-replay/replay`, {
      method: 'POST',
      headers: headers()
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { replayed: number }
    expect(body.replayed).toBe(3)

    const replays = harness.events.filter(function (event) {
      return event.kind === 'replay'
    })
    expect(replays).toHaveLength(3)
    expect(
      replays.map(function (event) {
        return (event.payload as Update).sessionUpdate
      })
    ).toEqual(['user_message_chunk', 'agent_message_chunk', 'tool_call'])
  })

  it('没有可补的会话时返回 200 + no_session（不报错）', async function () {
    const harness = await startServer({ stateValues: {} })
    await createThread(harness.base, 't-nosession')

    const response = await fetch(`${harness.base}/threads/t-nosession/replay`, {
      method: 'POST',
      headers: headers()
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { replayed: number; reason: string }
    expect(body.replayed).toBe(0)
    expect(body.reason).toBe('no_session')
  })

  it('这一轮还在跑时拒绝：409 run_active（不让 session/load 与 live 流交叉）', async function () {
    const harness = await startServer({ runDelayMs: 500 })
    await createThread(harness.base, 't-active')
    await fetch(`${harness.base}/threads/t-active/runs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'hi', cwd: CWD, mode: 'auto' } })
    })

    const response = await fetch(`${harness.base}/threads/t-active/replay`, {
      method: 'POST',
      headers: headers()
    })
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('run_active')
  })

  it('session/load 失败只回 502，不影响任何事件（旁路）', async function () {
    const harness = await startServer({ loadError: 'goose 未就绪' })
    await createThread(harness.base, 't-fail')

    const response = await fetch(`${harness.base}/threads/t-fail/replay`, {
      method: 'POST',
      headers: headers()
    })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('replay_failed')
    expect(
      harness.events.filter(function (event) {
        return event.kind === 'replay'
      })
    ).toHaveLength(0)
  })

  it('不存在的 thread 404', async function () {
    const harness = await startServer()
    const response = await fetch(`${harness.base}/threads/nope/replay`, {
      method: 'POST',
      headers: headers()
    })
    expect(response.status).toBe(404)
  })
})
