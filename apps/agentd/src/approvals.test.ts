/**
 * 审批闸门：挂住 ACP 回包，等用户回执再写回。
 *
 * 核心断言是**语义**而不是形状：没人回执就不能自动放行（fail-closed），
 * 线程结束时必须把等待者结掉（不能永久挂起），事件要能被 SSE 侧订阅到。
 */

import type { Server } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { APPROVAL_TIMEOUT_MS, createApprovalHub } from './approvals'
import type { ApprovalEvent } from './approvals'
import { createAgentServer } from './agent-server'
import { createEventHub } from './events'
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

function startServer(hub: ReturnType<typeof createApprovalHub>): Promise<string> {
  const agentServer = createAgentServer({
    graph: stubGraph as never,
    approvals: hub,
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

async function createThread(base: string): Promise<string> {
  const response = await fetch(`${base}/threads`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  })
  const body = (await response.json()) as { thread_id: string }
  return body.thread_id
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

describe('审批闸门', function () {
  it('回执被转发成 optionId；结案后列表里不再有它', async function () {
    const hub = createApprovalHub()
    const events: ApprovalEvent[] = []
    hub.subscribe(function (event) {
      events.push(event)
    })

    const pending = hub.ask({
      threadID: 't1',
      sessionId: 's1',
      toolCall: { title: 'write file' },
      options: [
        { optionId: 'allow', name: '允许', kind: 'allow_once' },
        { optionId: 'deny', name: '拒绝', kind: 'reject_once' }
      ]
    })

    expect(hub.pending('t1')).toHaveLength(1)
    const requestId = hub.pending('t1')[0].requestId
    expect(hub.settle(requestId, 'allow')).toBe(true)

    const decision = await pending
    expect(decision).toEqual({ optionId: 'allow' })
    expect(hub.pending('t1')).toHaveLength(0)
    expect(events.map(function (event) { return event.type })).toEqual([
      'approval_requested',
      'approval_settled'
    ])
    expect(events[1].optionId).toBe('allow')
  })

  it('取消结案返回 null（调用方按 cancelled 回写 ACP）', async function () {
    const hub = createApprovalHub()
    const pending = hub.ask({
      threadID: 't1',
      sessionId: 's1',
      toolCall: null,
      options: []
    })
    const requestId = hub.pending()[0].requestId
    expect(hub.settle(requestId, null)).toBe(true)
    expect(await pending).toBeNull()
  })

  it('线程结束会把它的等待者全部结掉，不留下永久挂起的请求', async function () {
    const hub = createApprovalHub()
    const first = hub.ask({ threadID: 't1', sessionId: 's1', toolCall: null, options: [] })
    const second = hub.ask({ threadID: 't2', sessionId: 's2', toolCall: null, options: [] })

    hub.cancelThread('t1')
    expect(await first).toBeNull()
    expect(hub.pending('t1')).toHaveLength(0)
    // 别的线程不受影响
    expect(hub.pending('t2')).toHaveLength(1)

    hub.cancelAll()
    expect(await second).toBeNull()
    expect(hub.pending()).toHaveLength(0)
  })

  it('重复结案返回 false（不重复 resolve）', async function () {
    const hub = createApprovalHub()
    const pending = hub.ask({ threadID: 't1', sessionId: 's1', toolCall: null, options: [] })
    const requestId = hub.pending()[0].requestId
    expect(hub.settle(requestId, 'a')).toBe(true)
    expect(hub.settle(requestId, 'b')).toBe(false)
    expect(await pending).toEqual({ optionId: 'a' })
  })

  it('按 sessionId 反查待审批（graph 侧只拿得到 sessionId）', function () {
    const hub = createApprovalHub()
    void hub.ask({ threadID: 't1', sessionId: 's1', toolCall: null, options: [] })
    expect(hub.pendingOf('s1')?.threadID).toBe('t1')
    expect(hub.pendingOf('nope')).toBeUndefined()
  })

  it('没人回执时超时按取消结案（fail-closed，不留永久悬挂）', async function () {
    const hub = createApprovalHub()
    // 用假时钟把 5 分钟压缩掉；真 timer 会拖住整轮测试
    vi.useFakeTimers()
    try {
      const pending = hub.ask({ threadID: 't1', sessionId: 's1', toolCall: null, options: [] })
      expect(hub.pending('t1')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS + 1)
      expect(await pending).toBeNull()
      expect(hub.pending('t1')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('审批 HTTP 面', function () {
  it('列表 → 回执 全程可用，404 用于已结案的 requestId', async function () {
    const hub = createApprovalHub()
    const base = await startServer(hub)
    const threadID = await createThread(base)

    void hub.ask({ threadID, sessionId: 's1', toolCall: null, options: [] })

    const list = await fetch(`${base}/threads/${threadID}/approvals`, { headers: authHeaders() })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { approvals: { requestId: string }[] }
    expect(listBody.approvals).toHaveLength(1)
    const requestId = listBody.approvals[0].requestId

    const settled = await fetch(`${base}/threads/${threadID}/approvals/${requestId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ optionId: 'allow' })
    })
    expect(settled.status).toBe(200)

    const again = await fetch(`${base}/threads/${threadID}/approvals/${requestId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ optionId: 'allow' })
    })
    expect(again.status).toBe(404)
  })

  it('事件流连上时先补发现状（请求可能早于订阅）', async function () {
    const hub = createApprovalHub()
    const base = await startServer(hub)
    const threadID = await createThread(base)
    void hub.ask({ threadID, sessionId: 's1', toolCall: null, options: [] })

    const controller = new AbortController()
    const response = await fetch(`${base}/threads/${threadID}/events`, {
      headers: authHeaders(),
      signal: controller.signal
    })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('sync')) {
      const chunk = await reader?.read()
      if (!chunk || chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    controller.abort()
    // 连上先补一份现状：审批请求可能早于订阅
    expect(text).toContain('event: sync')
    expect(text).toContain('requestId')
  })
})
