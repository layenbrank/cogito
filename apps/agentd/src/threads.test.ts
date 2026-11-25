/**
 * 线程生命周期：幂等建线程、同线程单飞、取消。
 *
 * 这三条是前端会话层的语义地基：
 * - `thread_id` 由客户端给，才能做到 agentd 重启后接着跑（它是 checkpoint 主键）；
 * - 同线程只允许一轮在跑，否则两轮交错写 checkpoint；
 * - 取消要让 goose 停（长工具）并中止图，否则界面停在「发送中」。
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
/** run 的 cwd 会在路由层校验存在性；用一个真实目录，别用 POSIX 风格的假路径 */
const CWD = tmpdir()

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
  it('非法 thread_id 被拒绝', async function () {
    const harness = await startServer({
      stream: function () {
        return Promise.resolve(
          (async function* () {
            yield ['values', {}]
          })()
        )
      }
    })
    const response = await fetch(`${harness.base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 'bad id/../../x' })
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('thread_id_invalid')
  })

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
      body: JSON.stringify({ input: { prompt: 'hi', cwd: CWD } })
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

describe('流式端点断连', function () {
  it('客户端断开后中止这一轮并取消 goose（不留下无人看的 run）', async function () {
    const harness = await startServer(slowGraph(3000))
    const base = harness.base
    await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: 't-stream' })
    })

    const controller = new AbortController()
    const response = await fetch(`${base}/threads/t-stream/runs/stream`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'hi', cwd: CWD } }),
      signal: controller.signal
    })
    expect(response.status).toBe(200)

    // 先读一帧，确保流已经建立；然后模拟客户端断开
    const reader = response.body?.getReader()
    await reader?.read()
    controller.abort()

    expect(
      await waitFor(function () {
        return harness.cancelled.includes('session-test')
      })
    ).toBe(true)
    // 断连也要有 settled：否则事件流订阅者会一直等
    expect(
      await waitFor(function () {
        return harness.events.some(function (event) {
          return event.kind === 'status' && (event.payload as { phase?: string }).phase === 'settled'
        })
      })
    ).toBe(true)
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
      body: JSON.stringify({ input: { prompt: 'first', cwd: CWD } })
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
      body: JSON.stringify({ input: { prompt: 'second', cwd: CWD } })
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

/**
 * 写者租约：同 thread 多客户端时**明确互斥**。
 *
 * 以前第二个客户端会静默抢占第一个的轮次，两个界面各自显示一半、审批互相抢。
 * 现在按 `x-cogito-client` 区分：自己的一轮可以 supersede，别人的必须显式 `takeover`。
 */
describe('写者租约', function () {
  function clientHeaders(clientID: string): Record<string, string> {
    return { ...headers(), 'x-cogito-client': clientID }
  }

  async function startRun(
    base: string,
    threadID: string,
    clientID: string,
    extra: Record<string, unknown> = {}
  ): Promise<Response> {
    return fetch(`${base}/threads/${threadID}/runs`, {
      method: 'POST',
      headers: clientHeaders(clientID),
      body: JSON.stringify({ input: { prompt: 'hi', cwd: CWD }, ...extra })
    })
  }

  async function startThread(base: string, threadID: string): Promise<void> {
    await fetch(`${base}/threads`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ thread_id: threadID })
    })
  }

  it('另一个客户端正在跑：409 writer_lease_held，且不会抢占它', async function () {
    const harness = await startServer(slowGraph(2000))
    const base = harness.base
    await startThread(base, 't-lease')

    const first = await startRun(base, 't-lease', 'client-a')
    expect(first.status).toBe(202)
    const firstBody = (await first.json()) as { run_id: string; revision: number }
    expect(firstBody.revision).toBe(1)

    // 等第一轮真的跑起来，否则租约还没登记
    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return (event.payload as { runID?: string }).runID === firstBody.run_id
      })
    })).toBe(true)

    const second = await startRun(base, 't-lease', 'client-b')
    expect(second.status).toBe(409)
    const body = (await second.json()) as {
      error: string
      holder: { clientID: string; runID: string; revision: number }
    }
    expect(body.error).toBe('writer_lease_held')
    expect(body.holder.clientID).toBe('client-a')
    expect(body.holder.runID).toBe(firstBody.run_id)
    // 被拦下的请求不能取消别人的一轮
    expect(harness.cancelled).toEqual([])
  })

  it('显式 takeover：允许接手，旧轮被收掉', async function () {
    const harness = await startServer(slowGraph(2000))
    const base = harness.base
    await startThread(base, 't-takeover')

    const first = await startRun(base, 't-takeover', 'client-a')
    const firstBody = (await first.json()) as { run_id: string }
    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return (event.payload as { runID?: string }).runID === firstBody.run_id
      })
    })).toBe(true)

    const second = await startRun(base, 't-takeover', 'client-b', { takeover: true })
    expect(second.status).toBe(202)
    expect(await waitFor(function () {
      return harness.cancelled.length > 0
    })).toBe(true)
  })

  it('同一客户端重发：允许（那就是自己的旧轮被 supersede）', async function () {
    const harness = await startServer(slowGraph(2000))
    const base = harness.base
    await startThread(base, 't-self')

    const first = await startRun(base, 't-self', 'client-a')
    const firstBody = (await first.json()) as { run_id: string }
    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return (event.payload as { runID?: string }).runID === firstBody.run_id
      })
    })).toBe(true)

    const second = await startRun(base, 't-self', 'client-a')
    expect(second.status).toBe(202)
    const secondBody = (await second.json()) as { revision: number }
    expect(secondBody.revision).toBe(2)
  })

  it('不带身份头的旧客户端：保持旧行为（允许），不因升级把老版本锁死', async function () {
    const harness = await startServer(slowGraph(2000))
    const base = harness.base
    await startThread(base, 't-legacy')

    const first = await fetch(`${base}/threads/t-legacy/runs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'hi', cwd: CWD } })
    })
    expect(first.status).toBe(202)
    expect(await waitFor(function () {
      return harness.events.some(function (event) {
        return (event.payload as { phase?: string }).phase === 'running'
      })
    })).toBe(true)

    const second = await fetch(`${base}/threads/t-legacy/runs`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ input: { prompt: 'again', cwd: CWD } })
    })
    expect(second.status).toBe(202)
  })
})
