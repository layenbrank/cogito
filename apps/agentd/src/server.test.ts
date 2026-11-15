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
