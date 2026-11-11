import { describe, expect, it } from 'vitest'

import {
  canConnect,
  canDisconnect,
  countConnectedServers,
  isMcpServerFailed,
  toMcpServerStatus,
  type McpServerView
} from './mcp-config-state'

function server(patch: Partial<McpServerView> = {}): McpServerView {
  return { id: 's', name: 'server', transport: 'streamable-http', status: 'connected', ...patch }
}

describe('toMcpServerStatus', function () {
  it('六档 manager 状态折成四档：authPending 归连接中、authRequired 归待授权', function () {
    expect(toMcpServerStatus('connected')).toBe('connected')
    expect(toMcpServerStatus('connecting')).toBe('connecting')
    expect(toMcpServerStatus('authPending')).toBe('connecting')
    expect(toMcpServerStatus('authRequired')).toBe('needs-auth')
    expect(toMcpServerStatus('error')).toBe('failed')
    expect(toMcpServerStatus('disconnected')).toBe('failed')
  })

  it('未知状态按失败处理，不会静默当成已连接', function () {
    expect(toMcpServerStatus('something-new')).toBe('failed')
    expect(toMcpServerStatus('')).toBe('failed')
  })
})

describe('countConnectedServers', function () {
  it('只数 connected（连接中 / 待授权 / 失败都不算）', function () {
    const servers = [
      server({ id: 'a' }),
      server({ id: 'b', status: 'connecting' }),
      server({ id: 'c', status: 'needs-auth' }),
      server({ id: 'd', status: 'failed' }),
      server({ id: 'e' })
    ]
    expect(countConnectedServers(servers)).toBe(2)
    expect(countConnectedServers([])).toBe(0)
  })
})

describe('动作可用性', function () {
  it('Connect 与 Disconnect 互斥，不会有档位同时给两个', function () {
    const statuses = ['connected', 'connecting', 'needs-auth', 'failed'] as const
    for (const status of statuses) {
      expect(canConnect(status) && canDisconnect(status)).toBe(false)
    }
  })

  it('还没连上给 Connect，连着或正在连给 Disconnect', function () {
    expect(canConnect('needs-auth')).toBe(true)
    expect(canConnect('failed')).toBe(true)
    expect(canConnect('connected')).toBe(false)
    expect(canConnect('connecting')).toBe(false)

    expect(canDisconnect('connected')).toBe(true)
    expect(canDisconnect('connecting')).toBe(true)
    expect(canDisconnect('needs-auth')).toBe(false)
    expect(canDisconnect('failed')).toBe(false)
  })
})

describe('isMcpServerFailed', function () {
  it('状态是 failed 或者带着连接错误都算失败', function () {
    expect(isMcpServerFailed(server({ status: 'failed' }))).toBe(true)
    expect(isMcpServerFailed(server({ status: 'connected', error: '401' }))).toBe(true)
    expect(isMcpServerFailed(server({ status: 'connected', error: '' }))).toBe(false)
    expect(isMcpServerFailed(server({ status: 'needs-auth' }))).toBe(false)
  })
})
