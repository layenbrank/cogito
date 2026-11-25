/**
 * `/goose/invoke` 的安全边界：白名单必须真的挡住 `session/prompt`。
 *
 * 这条闸门最怕两个方向出错：
 * - 放过了 `session/prompt` → 前端能绕过同线程单飞与事件流，两轮交错写 checkpoint；
 * - 放过了任意方法 → 透传端点退化成万能代理。
 */

import type { Server } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { ALLOWED_GOOSE_METHODS, isAllowedGooseMethod } from './goose/allowlist'
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

interface Call {
  method: string
  params: unknown
}

function startServer(): Promise<{ base: string; calls: Call[] }> {
  const calls: Call[] = []
  const agentServer = createAgentServer({
    graph: stubGraph as never,
    goose: {
      request: function (method: string, params?: unknown) {
        calls.push({ method, params })
        return Promise.resolve({ ok: true })
      },
      cancel: function () {
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

function headers(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
}

async function invoke(base: string, method: string, params?: unknown): Promise<Response> {
  return fetch(`${base}/goose/invoke`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ method, params })
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

describe('goose 方法白名单', function () {
  it('挡掉 session/prompt 与 session/new（必须走图 / 具名端点）', function () {
    expect(isAllowedGooseMethod('session/prompt')).toBe(false)
    expect(isAllowedGooseMethod('session/new')).toBe(false)
    expect(ALLOWED_GOOSE_METHODS).not.toContain('session/prompt')
    expect(ALLOWED_GOOSE_METHODS).not.toContain('session/new')
  })

  it('挡掉工具权限写入（否则公开面可撤销硬禁用）', function () {
    expect(isAllowedGooseMethod('_goose/unstable/tools/permissions/set')).toBe(false)
    expect(ALLOWED_GOOSE_METHODS).not.toContain('_goose/unstable/tools/permissions/set')
  })

  it('挡掉任意未列出的方法（fail-closed）', async function () {
    const { base, calls } = await startServer()
    const response = await invoke(base, 'session/delete_everything', {})
    expect(response.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('允许配置类方法并原样透传 params', async function () {
    const { base, calls } = await startServer()
    const params = { sessionId: 's1', configId: 'temperature', value: 0.5 }
    const response = await invoke(base, 'session/set_config_option', params)
    expect(response.status).toBe(200)
    expect(calls).toEqual([{ method: 'session/set_config_option', params }])
  })

  it('缺 method 时 400', async function () {
    const { base } = await startServer()
    const response = await fetch(`${base}/goose/invoke`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({})
    })
    expect(response.status).toBe(400)
  })
})
