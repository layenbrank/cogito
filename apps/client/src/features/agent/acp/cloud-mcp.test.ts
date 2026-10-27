import { beforeEach, describe, expect, it, vi } from 'vitest'

const findAuthToken = vi.fn<() => string | null>()
const findActiveTenantID = vi.fn<() => string | null>()
const addSessionExtension = vi.fn<() => Promise<void>>()

vi.mock('@/utils/auth', function () {
  return { findAuthToken: () => findAuthToken() }
})
vi.mock('@/utils/tenant', function () {
  return { findActiveTenantID: () => findActiveTenantID() }
})
vi.mock('@/utils/http/env', function () {
  return { ENV_URLS: { cogito: 'https://api.example.com/api/v1/' } }
})
vi.mock('@/features/agent/acp/goose-extensions', function () {
  return { addSessionExtension: () => addSessionExtension() }
})
vi.mock('@/utils/exception-report', function () {
  return { reportCaught: () => undefined }
})

async function load() {
  return import('@/features/agent/acp/cloud-mcp')
}

describe('cloud mcp', function () {
  beforeEach(function () {
    findAuthToken.mockReturnValue('jwt-token')
    findActiveTenantID.mockReturnValue('tenant-1')
    addSessionExtension.mockReset()
    addSessionExtension.mockResolvedValue(undefined)
  })

  it('拼出带当前令牌与租户的 streamable HTTP 扩展', async function () {
    const { buildCloudMcp } = await load()
    const extension = buildCloudMcp()
    expect(extension).not.toBeNull()
    if (!extension || extension.type !== 'mcp' || extension.server.type !== 'http') {
      throw new Error('应当是 http mcp 扩展')
    }
    // 末尾斜杠不能拼出 `//mcp`
    expect(extension.server.url).toBe('https://api.example.com/api/v1/mcp')
    expect(extension.server.name).toBe('cogito-cloud')
    expect(extension.server.headers).toEqual([
      { name: 'Authorization', value: 'Bearer jwt-token' },
      { name: 'X-Tenant-ID', value: 'tenant-1' }
    ])
  })

  it('缺令牌或租户时不构造（别挂一个必然 401 的扩展）', async function () {
    const { buildCloudMcp, mountCloudMcp } = await load()
    findAuthToken.mockReturnValue(null)
    expect(buildCloudMcp()).toBeNull()

    findAuthToken.mockReturnValue('jwt-token')
    findActiveTenantID.mockReturnValue(null)
    expect(buildCloudMcp()).toBeNull()

    const mounted = await mountCloudMcp({} as never, 'session-1')
    expect(mounted).toBe(false)
    expect(addSessionExtension).not.toHaveBeenCalled()
  })

  it('挂载成功返回 true；goose 拒绝时只告警不抛', async function () {
    const { mountCloudMcp } = await load()
    await expect(mountCloudMcp({} as never, 'session-1')).resolves.toBe(true)
    expect(addSessionExtension).toHaveBeenCalledTimes(1)

    addSessionExtension.mockRejectedValue(new Error('secrets 必须已存好'))
    await expect(mountCloudMcp({} as never, 'session-2')).resolves.toBe(false)
  })
})
