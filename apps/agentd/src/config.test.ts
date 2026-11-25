import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { MIN_TOKEN_LENGTH, parsePort, readConfig } from './config'

const BASE_ENV: NodeJS.ProcessEnv = {
  AGENTD_TOKEN: 'test-token-0123456789',
  AGENTD_DB: '/tmp/agentd.db'
}

describe('parsePort', function () {
  it('缺省与空串都是 0（内核分配）', function () {
    expect(parsePort(undefined)).toBe(0)
    expect(parsePort('   ')).toBe(0)
  })

  it('越界或非整数直接抛', function () {
    expect(function () {
      parsePort('70000')
    }).toThrow(/非法/)
    expect(function () {
      parsePort('1.5')
    }).toThrow(/非法/)
  })
})

describe('readConfig', function () {
  it('缺 token 或 token 过短都拒绝启动（fail-closed）', function () {
    expect(function () {
      readConfig({ AGENTD_DB: '/tmp/a.db' })
    }).toThrow(/AGENTD_TOKEN/)
    expect(function () {
      readConfig({ AGENTD_TOKEN: 'short', AGENTD_DB: '/tmp/a.db' })
    }).toThrow(/过短/)
    expect(MIN_TOKEN_LENGTH).toBeGreaterThan(8)
  })

  it('缺 AGENTD_DB 拒绝启动', function () {
    expect(function () {
      readConfig({ AGENTD_TOKEN: 'test-token-0123456789' })
    }).toThrow(/AGENTD_DB/)
  })

  it('未配 goose 根目录时 goose 视为 disabled', function () {
    const config = readConfig(BASE_ENV)
    expect(config.port).toBe(0)
    expect(config.goosePathRoot).toBeNull()
    expect(config.gooseBinary).toBeNull()
    expect(config.version).toBe('0.0.0-dev')
    expect(config.isolated).toBe(false)
    expect(config.allowedRoots).toEqual([])
    expect(config.mcpAllowedCommands).toEqual([])
    expect(config.allowBareMcpCommand).toBe(false)
    expect(config.allowArbitraryMcpCommand).toBe(false)
  })

  it('工作区根与 MCP 白名单按 path.delimiter 拆分', function () {
    const config = readConfig({
      ...BASE_ENV,
      AGENTD_ALLOWED_ROOTS: ['D:/work', 'E:/projects'].join(path.delimiter),
      AGENTD_MCP_ALLOWED_COMMANDS: ['D:/bin/cogito-mcp.exe'].join(path.delimiter),
      AGENTD_MCP_ALLOW_BARE_COMMAND: '1'
    })
    expect(config.allowedRoots).toEqual(['D:/work', 'E:/projects'])
    expect(config.mcpAllowedCommands).toEqual(['D:/bin/cogito-mcp.exe'])
    expect(config.allowBareMcpCommand).toBe(true)
  })

  it('显式配置原样生效', function () {
    const config = readConfig({
      ...BASE_ENV,
      AGENTD_PORT: '19829',
      AGENTD_GOOSE_PATH_ROOT: 'C:/data/goose',
      AGENTD_VERSION: '1.5.0',
      AGENTD_ISOLATED: '1'
    })
    expect(config.port).toBe(19829)
    expect(config.goosePathRoot).toBe('C:/data/goose')
    expect(config.version).toBe('1.5.0')
    expect(config.isolated).toBe(true)
  })
})
