/**
 * 线程生命周期：幂等建线程、同线程单飞、取消。
 *
 * 这三条是前端会话层的语义地基：
 * - `thread_id` 由客户端给，才能做到 agentd 重启后接着跑（它是 checkpoint 主键）；
 * - 同线程只允许一轮在跑，否则两轮交错写 checkpoint；
 * - 取消要让 goose 停（长工具）并中止图，否则界面停在「发送中」。
 */

import type { Server } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { createEventHub } from './events'
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
    goose: 'disabled',
    restarts: 0
  }
}

/** 慢图：给「抢占 / 取消」留出时间窗口。 */
function slowGraph(delayMs: number, sessionId = 'session-test'): Record<string, unknown> {
  return {
    stream: function () {
      return Promise.resolve(
        (async function* () {
          yield ['values', { step: 1 }]
          await new Promise<void>(function (resolve) {
            setTimeout(resolve, delayMs)
          })
          yield ['values', { step: 2 }]
        })()
      )
    },
    getState: function () {
      return Promise.resolve({ values: { sessionId } })
    }
  }
}

interface Harness {
  base: string
  events: RunEvent[]
  cancelled: string[]
}

async function startServer(graph: Record<string, unknown>): Promise<Harness> {
  const hub = createEventHub()
  const collected: RunEvent[] = []
  const cancelled: string[] = []
  const agentServer = createAgentServer({
    graph: graph as never,
    events: hub,
    goose: {
      request: function () {
        return Promise.resolve({})
      },
      cancel: function (sessionId: string) {
        cancelled.push(sessionId)
        return Promise.resolve()
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
      const url = `http://127.0.0.1:${port}`
      // 订阅所有线程的事件（测试里只看 status）
      const original = hub.emit
      hub.emit = function (...args: Parameters<typeof original>) {
        const event = original.apply(hub, args)
        collected.push(event)
        return event
      }
      resolve(url)
    })
    server.on('error', reject)
  })
  return { base, events: collected, cancelled }
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 3000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise<void>(function (resolve) {
      setTimeout(resolve, 20)
    })
  }
  return check()
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

describe('线程创建', function () {
  it('带 thread_id 时是幂等 upsert（重启后仍能对上 checkpoint 主键）', async function () {
    const { base } = await startServer(slowGraph(10))
    const first = await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 'local-session-1' })
    })
    const firstBody = (await first.json()) as { thread_id: string; created_at: string }
    expect(firstBody.thread_id).toBe('local-session-1')

    const second = await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 'local-session-1' })
    })
    const secondBody = (await second.json()) as { thread_id: string; created_at: string }
    expect(secondBody.thread_id).toBe('local-session-1')
    expect(secondBody.created_at).toBe(firstBody.created_at)

    const third = await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({})
    })
    const thirdBody = (await third.json()) as { thread_id: string }
    expect(thirdBody.thread_id).not.toBe('local-session-1')
  })
})

describe('取消', function () {
  it('有活跃轮时 202 并中止它，settled 一定落地', async function () {
    const harness = await startServer(slowGraph(2000))
    const base = harness.base
    await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 't-cancel' })
    })
    const run = await fetch(`${base}/threads/t-cancel/runs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'hi', cwd: '/w' } })
    })
    expect(run.status).toBe(202)

    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return event.kind === 'status' && (event.payload as { phase?: string }).phase === 'running'
      })
    })).toBe(true)

    const cancel = await fetch(`${base}/threads/t-cancel/cancel`, {
      method: 'POST',
      headers: headers()
    })
    expect(cancel.status).toBe(202)

    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return event.kind === 'status' && (event.payload as { phase?: string }).phase === 'settled'
      })
    })).toBe(true)
    // 取消要先打 ACP（长工具只有它能真正收住）
    expect(harness.cancelled).toContain('session-test')
  })

  it('没有活跃轮时 200 且不报错', async function () {
    const { base } = await startServer(slowGraph(10))
    await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 't-idle' })
    })
    const response = await fetch(`${base}/threads/t-idle/cancel`, {
      method: 'POST',
      headers: headers()
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { cancelled: boolean; reason: string }
    expect(body.cancelled).toBe(false)
    expect(body.reason).toBe('no_active_run')
  })
})

describe('同线程单飞', function () {
  it('第二轮会抢占第一轮：两个 run 都结案，不会交错挂着', async function () {
    const harness = await startServer(slowGraph(2000))
    const base = harness.base
    await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 't-serial' })
    })

    const first = await fetch(`${base}/threads/t-serial/runs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'first', cwd: '/w' } })
    })
    const firstBody = (await first.json()) as { run_id: string }

    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return (event.payload as { runID?: string }).runID === firstBody.run_id
      })
    })).toBe(true)

    const second = await fetch(`${base}/threads/t-serial/runs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'second', cwd: '/w' } })
    })
    const secondBody = (await second.json()) as { run_id: string }
    expect(secondBody.run_id).not.toBe(firstBody.run_id)

    // 第一轮被杀掉时也要有 settled（否则前端会一直等）—— 抢占会先 cancel + abort
    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        const payload = event.payload as { phase?: string; runID?: string }
        return payload.phase === 'settled' && payload.runID === firstBody.run_id
      })
    }, 5000)).toBe(true)
  })
})
