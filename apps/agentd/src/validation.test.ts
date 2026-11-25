import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  isAllowedSessionConfigID,
  parseAfterQuery,
  validateCwd,
  validateMcpServers,
  validateThreadID
} from './validation'

let root = ''
let inside = ''
let outside = ''
let filePath = ''
let productMcp = ''

beforeAll(async function () {
  root = await mkdtemp(join(tmpdir(), 'agentd-validation-'))
  inside = join(root, 'workspace')
  outside = await mkdtemp(join(tmpdir(), 'agentd-outside-'))
  filePath = join(root, 'not-a-dir.txt')
  await writeFile(filePath, 'x')
  productMcp = join(root, 'corex-mcp.exe')
  await writeFile(productMcp, 'stub')
  await mkdir(inside, { recursive: true })
})

afterAll(async function () {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('validateThreadID', function () {
  it('常见 id 通过', function () {
    expect(validateThreadID('local-session-1')).toEqual({ ok: true, value: 'local-session-1' })
    expect(validateThreadID('  abc_123  ')).toEqual({ ok: true, value: 'abc_123' })
  })

  it('空、超长、空白与路径分隔符都拒绝', function () {
    expect(validateThreadID('').ok).toBe(false)
    expect(validateThreadID('a'.repeat(201)).ok).toBe(false)
    expect(validateThreadID('a b').ok).toBe(false)
    expect(validateThreadID('../etc/passwd').ok).toBe(false)
    expect(validateThreadID('a\\b').ok).toBe(false)
    expect(validateThreadID(null).ok).toBe(false)
  })
})

describe('validateCwd', function () {
  it('存在的绝对目录通过', async function () {
    const result = await validateCwd(inside, [])
    expect(result.ok).toBe(true)
  })

  it('相对路径 / 不存在 / 文件都拒绝', async function () {
    expect((await validateCwd('relative/dir', [])).ok).toBe(false)
    expect((await validateCwd(join(root, 'missing'), [])).ok).toBe(false)
    expect((await validateCwd(filePath, [])).ok).toBe(false)
  })

  it('配置根之后只允许根内目录', async function () {
    expect((await validateCwd(inside, [root])).ok).toBe(true)
    const denied = await validateCwd(outside, [root])
    expect(denied).toMatchObject({ ok: false, code: 'cwd_not_allowed' })
  })

  it('根目录全部失效时 fail-closed', async function () {
    const result = await validateCwd(inside, [join(root, 'missing-root')])
    expect(result).toMatchObject({ ok: false, code: 'cwd_root_unavailable' })
  })
})

describe('validateMcpServers', function () {
  const bin = process.execPath

  it('空值 / 空数组通过', async function () {
    expect(await validateMcpServers(undefined)).toEqual({ ok: true, value: [] })
    expect(await validateMcpServers([])).toEqual({ ok: true, value: [] })
  })

  it('裸命令默认拒绝，放宽后允许', async function () {
    const server = { name: 'x', command: 'bash', args: [], env: [] }
    const denied = await validateMcpServers([server])
    expect(denied).toMatchObject({ ok: false, code: 'mcp_command_not_absolute' })
    const allowed = await validateMcpServers([server], { allowBareCommand: true })
    expect(allowed.ok).toBe(true)
  })

  it('绝对路径必须存在且是文件', async function () {
    const missing = await validateMcpServers([
      { name: 'x', command: join(root, 'missing.exe'), args: [], env: [] }
    ])
    expect(missing).toMatchObject({ ok: false, code: 'mcp_command_not_found' })

    const good = await validateMcpServers([
      { name: 'x', command: productMcp, args: ['--version'], env: [{ name: 'A', value: '1' }] }
    ])
    expect(good.ok).toBe(true)
  })

  it('默认只允许产品 MCP；任意绝对路径需要显式开关', async function () {
    const node = { name: 'x', command: process.execPath, args: [], env: [] }
    expect(await validateMcpServers([node])).toMatchObject({
      ok: false,
      code: 'mcp_command_not_allowed'
    })
    expect(await validateMcpServers([node], { allowArbitraryCommand: true })).toMatchObject({
      ok: true
    })
  })

  it('白名单生效', async function () {
    const denied = await validateMcpServers(
      [{ name: 'x', command: bin, args: [], env: [] }],
      { allowedCommands: [join(root, 'other.exe')] }
    )
    expect(denied).toMatchObject({ ok: false, code: 'mcp_command_not_allowed' })
  })

  it('形状校验：重名、坏 env、坏 args', async function () {
    expect(
      await validateMcpServers([
        { name: 'x', command: productMcp, args: [], env: [] },
        { name: 'x', command: productMcp, args: [], env: [] }
      ])
    ).toMatchObject({ ok: false, code: 'mcp_server_duplicate' })
    expect(
      await validateMcpServers(
        [{ name: 'x', command: bin, args: [], env: [{ name: '1BAD', value: 'v' }] }],
        { allowArbitraryCommand: true }
      )
    ).toMatchObject({ ok: false, code: 'mcp_env_name_invalid' })
    expect(
      await validateMcpServers([{ name: 'x', command: bin, args: [1], env: [] }], {
        allowArbitraryCommand: true
      })
    ).toMatchObject({ ok: false, code: 'mcp_args_invalid' })
  })
})

describe('parseAfterQuery', function () {
  it('缺省 → undefined，数字串 → number', function () {
    expect(parseAfterQuery(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseAfterQuery('42')).toEqual({ ok: true, value: 42 })
  })

  it('非法值不降级成全量补发', function () {
    expect(parseAfterQuery('abc').ok).toBe(false)
    expect(parseAfterQuery('-1').ok).toBe(false)
    expect(parseAfterQuery(['1', '2']).ok).toBe(false)
  })
})

describe('isAllowedSessionConfigID', function () {
  it('只放行 mode 与 thinking_effort', function () {
    expect(isAllowedSessionConfigID('mode')).toBe(true)
    expect(isAllowedSessionConfigID('thinking_effort')).toBe(true)
    expect(isAllowedSessionConfigID('temperature')).toBe(false)
    expect(isAllowedSessionConfigID(undefined)).toBe(false)
  })
})
