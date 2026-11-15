/**
 * goose 查询面透传（P4-a）：前端不再自己连 ACP，读操作都走 agentd。
 *
 * 这里只钉契约：路径 → ACP 方法名、未就绪 → 503、参数校验 → 400。
 * 真实 ACP 往返由 `agents/` 之外的 spike 与真机验证覆盖（本机没有可用 provider 时跑不了）。
 */

import type { Server } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []

interface Call {
  method: string
  params: unknown
}

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

/** 一个什么也不做的图：这组用例只关心路由，不跑 run。 */
const stubGraph = {
  stream: function () {
    return Promise.resolve(
      (async function* () {
        yield ['values', {}]
      })()
    )
  }
}

function startServer(options: {
  goose?: { request: (method: string, params?: unknown) => Promise<unknown> } | null
}): Promise<{ base: string; calls: Call[] }> {
  const calls: Call[] = []
  const goose = options.goose
    ? {
        request: function (method: string, params?: unknown) {
          calls.push({ method, params })
          return options.goose?.request(method, params) ?? Promise.resolve({})
        },
        cancel: function (sessionId: string) {
          calls.push({ method: 'session/cancel', params: { sessionId } })
          return Promise.resolve()
        }
      }
    : null
  const agentServer = createAgentServer({ graph: stubGraph as never, goose })
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
      resolve({ base: `http://127.0.0.1:${port}`, calls })
    })
    server.on('error', reject)
  })
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` }
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

describe('goose 查询面', function () {
  it('未托管 goose 时读接口一律 503', async function () {
    const { base } = await startServer({ goose: null })
    const response = await fetch(`${base}/goose/providers`, { headers: authHeaders() })
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('goose_unavailable')
  })

  it('把路径映射到 ACP 方法名并原样回包', async function () {
    const { base, calls } = await startServer({
      goose: {
        request: function (method: string) {
          return Promise.resolve({ method, items: [1, 2] })
        }
      }
    })

    const cases: { path: string; method: string }[] = [
      { path: '/goose/providers', method: '_goose/unstable/providers/list' },
      { path: '/goose/extensions', method: '_goose/unstable/config/extensions/list' },
      { path: '/goose/diagnostics', method: '_goose/unstable/diagnostics/get' },
      { path: '/goose/defaults', method: '_goose/unstable/defaults/read' },
      { path: '/goose/sessions', method: 'session/list' }
    ]
    for (const item of cases) {
      const response = await fetch(`${base}${item.path}`, { headers: authHeaders() })
      expect(response.status, item.path).toBe(200)
      const body = (await response.json()) as { method: string; items: number[] }
      expect(body.method).toBe(item.method)
      expect(body.items).toEqual([1, 2])
    }
    expect(calls.map(function (call) { return call.method })).toEqual(
      cases.map(function (item) { return item.method })
    )
  })

  it('建会话必须带 cwd，否则 400 且不打到 goose', async function () {
    const { base, calls } = await startServer({
      goose: { request: function () { return Promise.resolve({}) } }
    })

    const bad = await fetch(`${base}/goose/sessions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(bad.status).toBe(400)
    expect(calls).toHaveLength(0)

    const good = await fetch(`${base}/goose/sessions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/work' })
    })
    expect(good.status).toBe(200)
    expect(calls[0]).toEqual({ method: 'session/new', params: { cwd: 'C:/work', mcpServers: [] } })
  })

  it('会话配置与取消都透传 sessionId', async function () {
    const { base, calls } = await startServer({
      goose: { request: function () { return Promise.resolve({ ok: true }) } }
    })

    const config = await fetch(`${base}/goose/sessions/abc/config`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ configId: 'mode', value: 'approve' })
    })
    expect(config.status).toBe(200)

    const cancel = await fetch(`${base}/goose/sessions/abc/cancel`, {
      method: 'POST',
      headers: authHeaders()
    })
    expect(cancel.status).toBe(202)

    expect(calls[0]).toEqual({
      method: 'session/set_config_option',
      params: { sessionId: 'abc', configId: 'mode', value: 'approve' }
    })
    expect(calls[1]).toEqual({ method: 'session/cancel', params: { sessionId: 'abc' } })
  })

  it('goose 侧失败折成 502，不把错误当成 200 的空对象', async function () {
    const { base } = await startServer({
      goose: {
        request: function () {
          return Promise.reject(new Error('goose acp 未运行'))
        }
      }
    })
    const response = await fetch(`${base}/goose/providers`, { headers: authHeaders() })
    expect(response.status).toBe(502)
  })
})
