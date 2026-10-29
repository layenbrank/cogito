import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 请求拦截器给自家服务带一条新链路的 `traceparent`（服务端据此串起日志与下游调用）。
 * 这里直接抓住 `ofetch.create` 收到的 `onRequest` 调用它，比真起一个 server 更贴近
 * 「头是在哪一行加的」这件事。
 */

interface RequestContext {
  request: RequestInfo
  options: { headers: Headers; env?: string; baseURL?: string }
}

interface HttpConfig {
  onRequest: (context: RequestContext) => void
}

const deps = vi.hoisted(function () {
  const fetcher = vi.fn()
  const configs: HttpConfig[] = []
  const create = vi.fn(function (config: HttpConfig) {
    configs.push(config)
    return fetcher
  })
  const findAuthToken = vi.fn()

  return { configs, create, fetcher, findAuthToken }
})

vi.mock('ofetch', async function (importOriginal) {
  const actual: Record<string, unknown> = await importOriginal()
  return { ...actual, ofetch: { create: deps.create, fetcher: deps.fetcher } }
})

vi.mock('@tauri-apps/plugin-http', function () {
  return { fetch: vi.fn() }
})

vi.mock('@/utils/auth', function () {
  return { findAuthToken: deps.findAuthToken }
})

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
const OWN_API = 'https://api.example.com/api/v1'

/** `ENV_URLS` 在模块加载时成型，所以要换环境变量得重新加载模块 */
async function bootstrapHttp() {
  await import('@/utils/http/http.ts')
}

function send(request: RequestInfo, headers = new Headers()): Headers {
  deps.configs[deps.configs.length - 1].onRequest({ request, options: { headers } })
  return headers
}

beforeEach(async function () {
  vi.clearAllMocks()
  deps.findAuthToken.mockReturnValue('jwt-token')
  await bootstrapHttp()
})

afterEach(function () {
  vi.unstubAllEnvs()
})

describe('traceparent header', function () {
  it('opens a trace on our own services, sampled', function () {
    expect(send('/magnetic-tile').get('traceparent')).toMatch(TRACEPARENT)
    expect(send('/sync/push').get('traceparent')).toMatch(TRACEPARENT)
  })

  it('opens a trace on an absolute url of our own api', async function () {
    vi.stubEnv('VITE_COGITO', OWN_API)
    vi.resetModules()
    await bootstrapHttp()

    expect(send(`${OWN_API}/magnetic-tile`).get('traceparent')).toMatch(TRACEPARENT)
  })

  it('opens a fresh trace per request', function () {
    expect(send('/magnetic-tile').get('traceparent')).not.toBe(
      send('/magnetic-tile').get('traceparent')
    )
  })

  it('still opens a trace when signed out', function () {
    deps.findAuthToken.mockReturnValue(null)

    expect(send('/auth/signin').get('traceparent')).toMatch(TRACEPARENT)
  })

  it('keeps the traceparent the caller set', function () {
    const headers = new Headers({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    })

    expect(send('/magnetic-tile', headers).get('traceparent')).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    )
  })

  it('never sends a trace to another host', function () {
    expect(send('https://evil.example.com/api/v1/magnetic-tile').get('traceparent')).toBeNull()
  })
})
