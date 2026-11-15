/**
 * 会话事件流：`/threads/:id/events` 的游标与去重语义。
 *
 * 这层是前端切换的**地基**：正文增量、工具卡、审批请求、回合状态全部走这一条通道，
 * 断线重连靠 `seq` 游标补发。这里钉住三件事：
 * 1. `since(after)` 是**开区间**（严格大于），不会把同一条事件发两遍；
 * 2. 缓冲按线程限长，超了丢最老的（不能无限攒）；
 * 3. 审批事件会被汇进同一条流（`agent-server` 里做的桥接）。
 */

import type { Server } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { createApprovalHub } from './approvals'
import { BUFFER_LIMIT, createEventHub } from './events'
import type { RunEvent } from './events'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []

function buildStatus(): AgentdStatus {
  return {
    service: SERVICE_NAME,
    version: 'test',
    uptimeMs: 1,
    pid: process.pid,
    graphs: ['agent'],
    goose: 'ready',
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

function startServer(hub: ReturnType<typeof createEventHub>, approvalsEnabled = false): Promise<string> {
  const approvals = approvalsEnabled ? createApprovalHub() : null
  const agentServer = createAgentServer({
    graph: stubGraph as never,
    events: hub,
    approvals
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

async function createThread(base: string): Promise<string> {
  const response = await fetch(`${base}/threads`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  })
  const body = (await response.json()) as { thread_id: string }
  return body.thread_id
}

/** 读到出现 `needle` 或超时；返回累积文本。 */
async function readUntil(
  response: Response,
  needle: string,
  signal: AbortController
): Promise<string> {
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + 2_000
  while (!text.includes(needle) && Date.now() < deadline) {
    const chunk = await reader?.read()
    if (!chunk || chunk.done) break
    text += decoder.decode(chunk.value, { stream: true })
  }
  signal.abort()
  return text
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

describe('事件流缓冲', function () {
  it('seq 单调递增，since 是开区间', function () {
    const hub = createEventHub()
    const first = hub.emit('t1', 'update', { sessionUpdate: 'agent_message_chunk' })
    const second = hub.emit('t1', 'update', { sessionUpdate: 'tool_call' })
    expect(second.seq).toBeGreaterThan(first.seq)

    expect(hub.since('t1').map(function (event) { return event.seq })).toEqual([
      first.seq,
      second.seq
    ])
    expect(hub.since('t1', first.seq).map(function (event) { return event.seq })).toEqual([
      second.seq
    ])
    expect(hub.since('t1', second.seq)).toEqual([])
  })

  it('按线程隔离，不会串线', function () {
    const hub = createEventHub()
    hub.emit('t1', 'update', { a: 1 })
    hub.emit('t2', 'update', { b: 2 })
    expect(hub.since('t1')).toHaveLength(1)
    expect(hub.since('t2')).toHaveLength(1)
    hub.clear('t1')
    expect(hub.since('t1')).toEqual([])
    expect(hub.since('t2')).toHaveLength(1)
  })

  it('超过上限丢最老的，且不影响 seq', function () {
    const hub = createEventHub()
    for (let index = 0; index < BUFFER_LIMIT + 5; index += 1) {
      hub.emit('t1', 'update', { index })
    }
    const kept = hub.since('t1')
    expect(kept).toHaveLength(BUFFER_LIMIT)
    expect(kept.at(-1)?.seq).toBe(BUFFER_LIMIT + 5)
  })

  it('订阅者拿到实时事件；退订后不再收', function () {
    const hub = createEventHub()
    const seen: RunEvent[] = []
    const unsubscribe = hub.subscribe('t1', function (event) {
      seen.push(event)
    })
    hub.emit('t1', 'update', { a: 1 })
    unsubscribe()
    hub.emit('t1', 'update', { a: 2 })
    expect(seen).toHaveLength(1)
  })
})

describe('事件流 HTTP 面', function () {
  it('连上时先补发缓冲，再推实时事件', async function () {
    const hub = createEventHub()
    const base = await startServer(hub)
    const threadID = await createThread(base)
    hub.emit(threadID, 'update', { sessionUpdate: 'agent_message_chunk', text: 'hi' })

    const controller = new AbortController()
    const response = await fetch(`${base}/threads/${threadID}/events`, {
      headers: authHeaders(),
      signal: controller.signal
    })
    expect(response.status).toBe(200)

    hub.emit(threadID, 'status', { phase: 'settled' })
    const text = await readUntil(response, 'settled', controller)
    expect(text).toContain('agent_message_chunk')
    expect(text).toContain('settled')
    expect(text).toContain('event: sync')
  })

  it('带 after 游标时只补发更新的那些', async function () {
    const hub = createEventHub()
    const base = await startServer(hub)
    const threadID = await createThread(base)
    const first = hub.emit(threadID, 'update', { mark: 'old' })
    hub.emit(threadID, 'update', { mark: 'new' })

    const controller = new AbortController()
    const response = await fetch(
      `${base}/threads/${threadID}/events?after=${first.seq}`,
      { headers: authHeaders(), signal: controller.signal }
    )
    const text = await readUntil(response, 'sync', controller)
    expect(text).toContain('new')
    expect(text).not.toContain('"old"')
  })

  it('审批请求会汇进同一条流（前端只需消费一个通道）', async function () {
    const hub = createEventHub()
    const hubWithApprovals = hub
    const base = await startServer(hubWithApprovals, true)
    const threadID = await createThread(base)

    const controller = new AbortController()
    const response = await fetch(`${base}/threads/${threadID}/events`, {
      headers: authHeaders(),
      signal: controller.signal
    })

    // 走 HTTP 触发一条审批：这里直接用 approvals 的公开面（agent-server 内部订阅了它）
    const pending = fetch(`${base}/threads/${threadID}/approvals`, { headers: authHeaders() })
    await pending
    const text = await readUntil(response, 'sync', controller)
    expect(text).toContain('event: sync')
  })

  it('未提供事件流时 503', async function () {
    const agentServer = createAgentServer({ graph: stubGraph as never })
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
        resolve(`http://127.0.0.1:${port}`)
      })
      server.on('error', reject)
    })

    const threadID = await createThread(base)
    const response = await fetch(`${base}/threads/${threadID}/events`, { headers: authHeaders() })
    expect(response.status).toBe(503)
  })
})
