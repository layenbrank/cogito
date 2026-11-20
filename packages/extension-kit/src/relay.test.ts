import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CLIP_PORT_RELEASE,
  MESSAGE_CLIP_ACTIVE,
  MESSAGE_HEALTH,
  STORAGE_CLIP_DELIVERY
} from './constants.ts'
import { installClipRelay } from './relay.ts'

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean

interface FakeChrome {
  runtime: { onMessage: { addListener: (listener: Listener) => void } }
  tabs: { query: () => Promise<Array<{ id?: number }>> }
  scripting: { executeScript: () => Promise<Array<{ result?: unknown }>> }
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>
      set: (patch: Record<string, unknown>) => Promise<void>
    }
  }
}

interface FakeEnv {
  chrome: FakeChrome
  listeners: Listener[]
  stored: Record<string, unknown>
  /** 页面快照：`executeScript` 注入抽取函数后拿到的结果 */
  snapshot: unknown
  /** 活动标签；空数组 = 没有活动页 */
  tabs: Array<{ id?: number }>
  /** `/clip` 的应答；默认 200 */
  clipStatus: number
}

/**
 * 装一套假的 `chrome` 与 `fetch`，再调一次 `installClipRelay()`。
 *
 * 只覆盖 relay 真正用到的那几个 API：换消息、查活动标签、注入抽取、读写 storage、POST /clip。
 */
function installFake(): FakeEnv {
  const env: FakeEnv = {
    chrome: {
      runtime: { onMessage: { addListener: () => {} } },
      tabs: { query: async () => env.tabs },
      scripting: {
        executeScript: async () => [{ result: env.snapshot }]
      },
      storage: {
        local: {
          get: async (key) => ({ [key]: env.stored[key] }),
          set: async (patch) => {
            Object.assign(env.stored, patch)
          }
        }
      }
    },
    listeners: [],
    stored: {},
    snapshot: { title: '标题', url: 'https://example.com', text: '正文' },
    tabs: [{ id: 7 }],
    clipStatus: 200
  }

  env.chrome.runtime.onMessage.addListener = function (listener) {
    env.listeners.push(listener)
  }

  vi.stubGlobal('chrome', env.chrome)
  vi.stubGlobal('fetch', async function (input: string | URL) {
    if (String(input).endsWith('/health')) {
      return new Response(JSON.stringify({ clipCount: 3 }), { status: 200 })
    }
    return new Response(env.clipStatus === 200 ? 'saved' : 'boom', { status: env.clipStatus })
  })

  installClipRelay()
  return env
}

/** 按 MV3 的语义发一条消息：listener 返回 true 表示异步应答，false 表示不接管 */
function send(env: FakeEnv, message: unknown): Promise<unknown> {
  const listener = env.listeners[0]
  expect(listener).toBeTypeOf('function')
  return new Promise(function (resolve) {
    const claimed = listener(message, {}, resolve)
    if (!claimed) resolve(undefined)
  })
}

afterEach(function () {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('剪藏 relay（service worker 那一半）', function () {
  it('剪藏当前页：抽取 → 投递 → 记端口与结果', async function () {
    const env = installFake()

    const response = await send(env, { type: MESSAGE_CLIP_ACTIVE })

    expect(response).toMatchObject({ ok: true, port: CLIP_PORT_RELEASE })
    // 结果与端口都要落 storage：弹窗打开时靠它们复述「上次剪藏」
    expect(env.stored[STORAGE_CLIP_DELIVERY]).toMatchObject({ ok: true, port: CLIP_PORT_RELEASE })
  })

  it('没有活动标签时直接失败，不写结果', async function () {
    const env = installFake()
    env.tabs = []

    const response = await send(env, { type: MESSAGE_CLIP_ACTIVE })

    expect(response).toEqual({ ok: false, error: '没有活动标签页' })
    expect(env.stored[STORAGE_CLIP_DELIVERY]).toBeUndefined()
  })

  it('注入失败要带回原因（并留日志）', async function () {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {})
    const env = installFake()
    env.chrome.scripting.executeScript = async () => {
      throw new Error('Cannot access contents of the page')
    }

    const response = await send(env, { type: MESSAGE_CLIP_ACTIVE })

    expect(response).toEqual({ ok: false, error: 'Cannot access contents of the page' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('client 不在时把失败详情收进 error，而不是静默成功', async function () {
    const env = installFake()
    env.clipStatus = 502

    const response = await send(env, { type: MESSAGE_CLIP_ACTIVE })

    // 失败时 `deliverClip` 优先用响应体的报错原文（比状态码更能说明问题）
    expect(response).toMatchObject({ ok: false, error: 'boom' })
  })

  it('健康检查回 client 的端口与计数', async function () {
    const env = installFake()

    const response = await send(env, { type: MESSAGE_HEALTH })

    expect(response).toMatchObject({ ok: true, port: CLIP_PORT_RELEASE, clipCount: 3 })
  })

  it('不认识的消息不接管（交还给别的监听器）', function () {
    const env = installFake()

    expect(env.listeners[0]({ type: 'not-ours' }, {}, function () {})).toBe(false)
    // 字符串 / 空值也不该抛出
    expect(env.listeners[0]('weird', {}, function () {})).toBe(false)
  })
})
