/**
 * 结构化追问闸门：挂住 `elicitation/create` 的 ACP 回包，等前端填表。
 *
 * 断言的是**语义**：没人在听时按 decline（不是挂住）、超时按 cancel、线程结束必须结案、
 * 回执形状必须与 ACP 对得上（`accept` 要带 `content`）。
 */

import type { Server } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAgentServer } from './agent-server'
import { createApprovalHub } from './approvals'
import { createElicitationHub, ELICITATION_TIMEOUT_MS } from './elicitations'
import type { ElicitationEvent } from './elicitations'
import { createEventHub } from './events'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []

const FORM = {
  mode: 'form' as const,
  message: '用哪个目录？',
  requestedSchema: {
    type: 'object',
    title: '目录',
    properties: { dir: { type: 'string' } }
  }
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

const stubGraph = {
  stream: function () {
    return Promise.resolve(
      (async function* () {
        yield ['values', {}]
      })()
    )
  }
}

function startServer(options?: {
  elicitations?: ReturnType<typeof createElicitationHub>
}): Promise<string> {
  const agentServer = createAgentServer({
    graph: stubGraph as never,
    approvals: createApprovalHub(),
    elicitations: options?.elicitations ?? createElicitationHub(),
    events: createEventHub()
  })
  const app = createApp({
    token: TOKEN,
    status: buildStatus,
    onShutdown: function () {},
    mount: function (target) {
      agentServer.mount(target)
    }
  })
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      running.push(server)
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve(`http://127.0.0.1:${port}`)
    })
    server.on('error', reject)
  })
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
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

describe('追问闸门', function () {
  it('accept 会把 content 原样交给调用方', async function () {
    const hub = createElicitationHub()
    const events: ElicitationEvent[] = []
    hub.subscribe(function (event) {
      events.push(event)
    })

    const pending = hub.ask({ threadID: 't1', sessionId: 's1', ...FORM })
    expect(hub.pending('t1')).toHaveLength(1)
    const requestId = hub.pending('t1')[0].requestId
    expect(hub.settle(requestId, { action: 'accept', content: { dir: '/tmp/x' } })).toBe(true)

    expect(await pending).toEqual({ action: 'accept', content: { dir: '/tmp/x' } })
    expect(hub.pending('t1')).toHaveLength(0)
    expect(events.map(function (event) { return event.type })).toEqual([
      'elicitation_requested',
      'elicitation_settled'
    ])
  })

  it('decline / cancel 都不带 content（形状必须与 ACP 一致）', async function () {
    const hub = createElicitationHub()
    const declined = hub.ask({ threadID: 't1', sessionId: 's1', ...FORM })
    hub.settle(hub.pending()[0].requestId, { action: 'decline' })
    expect(await declined).toEqual({ action: 'decline' })

    const cancelled = hub.ask({ threadID: 't2', sessionId: 's2', ...FORM })
    hub.settle(hub.pending('t2')[0].requestId, { action: 'cancel' })
    expect(await cancelled).toEqual({ action: 'cancel' })
  })

  it('线程结束会把等待者结案，不留永久挂起', async function () {
    const hub = createElicitationHub()
    const first = hub.ask({ threadID: 't1', sessionId: 's1', ...FORM })
    const second = hub.ask({ threadID: 't2', sessionId: 's2', ...FORM })

    hub.cancelThread('t1')
    expect(await first).toEqual({ action: 'cancel' })
    expect(hub.pending('t1')).toHaveLength(0)
    expect(hub.pending('t2')).toHaveLength(1)

    hub.cancelAll()
    expect(await second).toEqual({ action: 'cancel' })
    expect(hub.pending()).toHaveLength(0)
  })

  it('重复结案返回 false', async function () {
    const hub = createElicitationHub()
    const pending = hub.ask({ threadID: 't1', sessionId: 's1', ...FORM })
    const requestId = hub.pending()[0].requestId
    expect(hub.settle(requestId, { action: 'accept' })).toBe(true)
    expect(hub.settle(requestId, { action: 'cancel' })).toBe(false)
    expect(await pending).toEqual({ action: 'accept' })
  })

  it('没人回执时超时按 cancel 结案', async function () {
    const hub = createElicitationHub()
    vi.useFakeTimers()
    try {
      const pending = hub.ask({ threadID: 't1', sessionId: 's1', ...FORM })
      await vi.advanceTimersByTimeAsync(ELICITATION_TIMEOUT_MS + 1)
      expect(await pending).toEqual({ action: 'cancel' })
      expect(hub.pending('t1')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('追问 HTTP 面', function () {
  async function createThread(base: string): Promise<string> {
    const response = await fetch(`${base}/threads`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({})
    })
    const body = (await response.json()) as { thread_id: string }
    return body.thread_id
  }

  it('列出待追问 → 回执 accept → 列表清空', async function () {
    const hub = createElicitationHub()
    const base = await startServer({ elicitations: hub })
    const threadID = await createThread(base)

    const pending = hub.ask({ threadID, sessionId: 's1', ...FORM })
    const list = await fetch(`${base}/threads/${threadID}/elicitations`, {
      headers: authHeaders()
    })
    const listed = (await list.json()) as { elicitations: { requestId: string }[] }
    expect(listed.elicitations).toHaveLength(1)
    const requestId = listed.elicitations[0].requestId

    const reply = await fetch(`${base}/threads/${threadID}/elicitations/${requestId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'accept', content: { dir: '/tmp' } })
    })
    expect(reply.status).toBe(200)
    expect(await pending).toEqual({ action: 'accept', content: { dir: '/tmp' } })

    const after = await fetch(`${base}/threads/${threadID}/elicitations`, {
      headers: authHeaders()
    })
    const empty = (await after.json()) as { elicitations: unknown[] }
    expect(empty.elicitations).toHaveLength(0)
  })

  it('未知 requestId 返回 404（已结案的不重复 resolve）', async function () {
    const base = await startServer()
    const threadID = await createThread(base)
    const reply = await fetch(`${base}/threads/${threadID}/elicitations/nope`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'accept' })
    })
    expect(reply.status).toBe(404)
  })

  it('无法识别的 action 一律按 decline（fail-closed）', async function () {
    const hub = createElicitationHub()
    const base = await startServer({ elicitations: hub })
    const threadID = await createThread(base)
    const pending = hub.ask({ threadID, sessionId: 's1', ...FORM })
    const requestId = hub.pending()[0].requestId

    const reply = await fetch(`${base}/threads/${threadID}/elicitations/${requestId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'something-else' })
    })
    expect(reply.status).toBe(200)
    expect(await pending).toEqual({ action: 'decline' })
  })
})
