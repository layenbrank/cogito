import type { Server } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []

function buildStatus(): AgentdStatus {
  return {
    service: SERVICE_NAME,
    version: '1.2.3-test',
    uptimeMs: 42,
    pid: process.pid,
    graphs: [],
    goose: 'disabled',
    restarts: 0
  }
}

function start(onShutdown?: () => void): Promise<{ base: string }> {
  const app = createApp({
    token: TOKEN,
    status: buildStatus,
    onShutdown: onShutdown ?? function () {}
  })
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      running.push(server)
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ base: `http://127.0.0.1:${port}` })
    })
    server.on('error', reject)
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

describe('GET /health', function () {
  it('免鉴权，且带服务身份标记', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as AgentdStatus
    expect(body.service).toBe('cogito-agentd')
    expect(body.version).toBe('1.2.3-test')
    expect(body.pid).toBe(process.pid)
  })
})

describe('bearer 鉴权', function () {
  it('缺 token 的管理端点返回 401', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/admin/shutdown`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('错 token 返回 401', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/admin/shutdown`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token-0123456' }
    })
    expect(res.status).toBe(401)
  })

  it('正确 token 返回 202 并触发关闭回调', async function () {
    const onShutdown = vi.fn()
    const { base } = await start(onShutdown)
    const res = await fetch(`${base}/admin/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(res.status).toBe(202)
    await new Promise<void>(function (resolve) {
      setImmediate(resolve)
    })
    expect(onShutdown).toHaveBeenCalledTimes(1)
  })

  it('未知路径在鉴权后返回 404', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(res.status).toBe(404)
  })
})

/**
 * 跨源：浏览器里 `localhost:<vite>` → `127.0.0.1:<agentd>` 是跨 origin，
 * 且带 `Authorization` 属非简单请求，浏览器会先发一个**不带 token** 的预检。
 * 预检落到鉴权上就是 401，前端只会看到一句 `Failed to fetch`（Node 的 fetch 不做 CORS 检查，
 * 所以这条只能靠显式断言响应头来守）。
 */
describe('CORS', function () {
  const ORIGIN = 'http://localhost:8200'

  it('预检免鉴权，且回显 Origin / 方法 / 头', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/threads`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type'
      }
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect((res.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain(
      'authorization'
    )
  })

  it('普通响应带 allow-origin 与 Vary', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/health`, { headers: { origin: ORIGIN } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('vary')).toContain('Origin')
  })

  it('没有 Origin 时不发 CORS 头（非浏览器调用不受影响）', async function () {
    const { base } = await start()
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
