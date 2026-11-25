/**
 * goose 查询面透传（P4-a）：前端不再自己连 ACP，读操作都走 agentd。
 *
 * 这里只钉契约：路径 → ACP 方法名、未就绪 → 503、参数校验 → 400。
 * 真实 ACP 往返由 `agents/` 之外的 spike 与真机验证覆盖（本机没有可用 provider 时跑不了）。
 */

import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    const cwd = await mkdtemp(join(tmpdir(), 'agentd-cwd-'))

    try {
      const bad = await fetch(`${base}/goose/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(bad.status).toBe(400)
      expect(calls).toHaveLength(0)

      const missing = await fetch(`${base}/goose/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: join(cwd, 'does-not-exist') })
      })
      expect(missing.status).toBe(400)
      expect(calls).toHaveLength(0)

      const good = await fetch(`${base}/goose/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ cwd })
      })
      expect(good.status).toBe(200)
      expect(calls[0]).toEqual({ method: 'session/new', params: { cwd, mcpServers: [] } })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('run 的 cwd 不在允许根内时 400', async function () {
    const { base } = await startServer({
      goose: { request: function () { return Promise.resolve({}) } }
    })
    const thread = await fetch(`${base}/threads`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ thread_id: 'cwd-check' })
    })
    expect(thread.status).toBe(200)

    const response = await fetch(`${base}/threads/cwd-check/runs`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ input: { prompt: 'hi', cwd: 'C:/definitely-missing-agentd-dir' } })
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('cwd_not_found')
  })

  it('MCP command 必须是绝对路径且存在', async function () {
    const { base, calls } = await startServer({
      goose: { request: function () { return Promise.resolve({}) } }
    })
    const cwd = await mkdtemp(join(tmpdir(), 'agentd-cwd-'))

    try {
      const bare = await fetch(`${base}/goose/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd,
          mcpServers: [{ name: 'evil', command: 'bash', args: [], env: [] }]
        })
      })
      expect(bare.status).toBe(400)
      const body = (await bare.json()) as { error: string }
      expect(body.error).toBe('mcp_command_not_absolute')
      expect(calls).toHaveLength(0)

      const missing = await fetch(`${base}/goose/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd,
          mcpServers: [
            { name: 'gone', command: join(cwd, 'nope.exe'), args: [], env: [] }
          ]
        })
      })
      expect(missing.status).toBe(400)
      expect(calls).toHaveLength(0)

      const product = join(cwd, 'corex-mcp.exe')
      await writeFile(product, 'stub')
      const good = await fetch(`${base}/goose/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd,
          mcpServers: [{ name: 'corex', command: product, args: [], env: [] }]
        })
      })
      expect(good.status).toBe(200)
      expect(calls[0]).toEqual({
        method: 'session/new',
        params: { cwd, mcpServers: [{ name: 'corex', command: product, args: [], env: [] }] }
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('会话配置只允许已知 configId', async function () {
    const { base, calls } = await startServer({
      goose: { request: function () { return Promise.resolve({ ok: true }) } }
    })

    const denied = await fetch(`${base}/goose/sessions/abc/config`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ configId: 'arbitrary', value: 1 })
    })
    expect(denied.status).toBe(400)
    expect(calls).toHaveLength(0)

    const allowed = await fetch(`${base}/goose/sessions/abc/config`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ configId: 'mode', value: 'approve' })
    })
    expect(allowed.status).toBe(200)
    expect(calls[0]).toEqual({
      method: 'session/set_config_option',
      params: { sessionId: 'abc', configId: 'mode', value: 'approve' }
    })
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
