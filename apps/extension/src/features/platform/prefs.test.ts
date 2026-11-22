/**
 * 偏好层的单元测试。
 *
 * 重点是「旧版本存的对象缺新字段」这条：偏好是整体读写的，缺字段补默认值、
 * 非法值一律丢弃 —— 否则一个手改过的 `agent.bridgePort = "19828"` 会让探活逻辑
 * 拿着字符串去拼 URL。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (changes: Record<string, { newValue?: unknown }>) => void

interface FakeChrome {
  storage: {
    local: {
      bag: Record<string, unknown>
      listeners: Set<Listener>
      get: (key: string) => Promise<Record<string, unknown>>
      set: (patch: Record<string, unknown>) => Promise<void>
      remove: (key: string) => Promise<void>
      onChanged: {
        addListener: (listener: Listener) => void
        removeListener: (listener: Listener) => void
      }
    }
  }
}

function installFakeChrome(): FakeChrome {
  const bag: Record<string, unknown> = {}
  const listeners = new Set<Listener>()
  const local = {
    bag,
    listeners,
    get: function (key: string) {
      return Promise.resolve(key in bag ? { [key]: bag[key] } : {})
    },
    set: function (patch: Record<string, unknown>) {
      const changes: Record<string, { newValue?: unknown }> = {}
      for (const [key, value] of Object.entries(patch)) {
        bag[key] = value
        changes[key] = { newValue: value }
      }
      for (const listener of listeners) listener(changes)
      return Promise.resolve()
    },
    remove: function (key: string) {
      delete bag[key]
      return Promise.resolve()
    },
    onChanged: {
      addListener: function (listener: Listener) {
        listeners.add(listener)
      },
      removeListener: function (listener: Listener) {
        listeners.delete(listener)
      }
    }
  }
  const fake: FakeChrome = { storage: { local } }
  vi.stubGlobal('chrome', fake)
  return fake
}

/** 模块级缓存要清掉，每个用例从「进程刚启动」开始 */
async function loadPrefs() {
  vi.resetModules()
  return await import('./prefs.ts')
}

beforeEach(function () {
  vi.unstubAllGlobals()
  installFakeChrome()
})

afterEach(function () {
  vi.unstubAllGlobals()
})

describe('ensurePrefs', function () {
  it('空存储给出默认值', async function () {
    const prefs = await loadPrefs()
    await prefs.ensurePrefs()
    expect(prefs.findPref('agent').approvalMode).toBe('ask')
    expect(prefs.findPref('agent').bridgeToken).toBe('')
    expect(prefs.findPref('agent').bridgePort).toBeNull()
  })

  it('已存的旧对象缺字段时补默认，已有字段保留', async function () {
    const fake = installFakeChrome()
    fake.storage.local.bag['cogito.prefs'] = {
      agent: { bridgeToken: 'tok', providerID: 'cogito_gateway' }
    }
    const prefs = await loadPrefs()
    await prefs.ensurePrefs()
    expect(prefs.findPref('agent').bridgeToken).toBe('tok')
    expect(prefs.findPref('agent').providerID).toBe('cogito_gateway')
    expect(prefs.findPref('agent').approvalMode).toBe('ask')
    expect(prefs.findPref('agent').model).toBeNull()
  })

  it('非法字段被丢弃（手改过的库不该让下游拿到错误类型）', async function () {
    const fake = installFakeChrome()
    fake.storage.local.bag['cogito.prefs'] = {
      agent: { approvalMode: 'yolo', bridgePort: '19828', model: 42 }
    }
    const prefs = await loadPrefs()
    await prefs.ensurePrefs()
    expect(prefs.findPref('agent').approvalMode).toBe('ask')
    expect(prefs.findPref('agent').bridgePort).toBeNull()
    expect(prefs.findPref('agent').model).toBeNull()
  })
})

describe('patchPref', function () {
  it('立刻改内存、异步落盘、并通知订阅者', async function () {
    const prefs = await loadPrefs()
    await prefs.ensurePrefs()
    const seen: string[] = []
    const stop = prefs.subscribePrefs(function () {
      seen.push(prefs.findPref('agent').bridgeToken)
    })

    await prefs.patchPref('agent', { bridgeToken: 'abc' })
    stop()

    // 同步可见：渲染路径不会 await 写入
    expect(prefs.findPref('agent').bridgeToken).toBe('abc')
    expect(seen).toContain('abc')

    const bag = (globalThis.chrome as unknown as FakeChrome).storage.local.bag
    expect((bag['cogito.prefs'] as { agent: { bridgeToken: string } }).agent.bridgeToken).toBe('abc')
  })

  it('只合并指定 namespace，别的 namespace 不受影响', async function () {
    const prefs = await loadPrefs()
    await prefs.ensurePrefs()
    await prefs.patchPref('agent', { bridgePort: 19829 })
    expect(prefs.findPref('agent').bridgePort).toBe(19829)
    expect(prefs.findPref('agent').approvalMode).toBe('ask')
  })
})
