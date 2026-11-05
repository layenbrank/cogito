/**
 * `monaco-language` 的按需注册契约（验证 7 的「语言贡献按需」部分）。
 *
 * 关注三件事：
 * 1. 白名单内的语言真的会加载贡献、白名单外的一律不碰（决定 monaco 入口能瘦多少）；
 * 2. 同一语言只加载一次，并发调用复用同一个 Promise（否则同一份语法被拉多遍）；
 * 3. 加载失败不写「已加载」标记，下一次还能重试（网络/IO 抖动不该永久少高亮）。
 *
 * 真实的 monaco contribution 会往 monaco 单例上注册语言、依赖 editor 运行时，
 * 在 jsdom 里既慢又没必要 —— 这里整组 mock 掉，只断言调用与状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMonacoMock } = vi.hoisted(function () {
  return {
    importMonacoMock: vi.fn(function (): Promise<unknown> {
      return Promise.resolve({})
    })
  }
})

vi.mock('@/lib/monaco-loader.ts', function () {
  return { importMonaco: importMonacoMock }
})

vi.mock('monaco-editor/languages/definitions/typescript/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/javascript/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/markdown/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/css/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/scss/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/html/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/python/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/rust/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/yaml/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/sql/register', function () {
  return {}
})
vi.mock('monaco-editor/languages/definitions/shell/register', function () {
  return {}
})
vi.mock('monaco-editor/language/css/monaco.contribution', function () {
  return {}
})
vi.mock('monaco-editor/language/html/monaco.contribution', function () {
  return {}
})

/** 只取类型；运行时由动态 import 拿全新实例（`loadedLanguages` 是模块级状态） */
import type * as MonacoLanguageModule from './monaco-language'

async function load(): Promise<typeof MonacoLanguageModule> {
  return import('./monaco-language')
}

/** 计划「实施步骤 7」的首批白名单（扩展名 → 语言 id） */
const WHITELIST = [
  'typescript',
  'javascript',
  'markdown',
  'css',
  'scss',
  'html',
  'python',
  'rust',
  'yaml',
  'sql',
  'shell'
]

beforeEach(function () {
  vi.resetModules()
  importMonacoMock.mockReset()
  importMonacoMock.mockImplementation(function (): Promise<unknown> {
    return Promise.resolve({})
  })
})

describe('ensureMonacoLanguage', function () {
  it('空 languageId 直接返回，不碰 monaco', async function () {
    const mod = await load()
    await mod.ensureMonacoLanguage('')
    expect(importMonacoMock).not.toHaveBeenCalled()
    expect(mod.findLoadedLanguages()).toEqual([])
  })

  it('白名单外的语言（abap / freemarker2）不加载任何东西，只记入已处理', async function () {
    const mod = await load()
    await mod.ensureMonacoLanguage('abap')
    await mod.ensureMonacoLanguage('freemarker2')

    expect(importMonacoMock).not.toHaveBeenCalled()
    expect(mod.findLoadedLanguages()).toEqual(['abap', 'freemarker2'])
  })

  it('计划首批白名单 11 种语言都能加载贡献，每个语言一次', async function () {
    const mod = await load()
    for (const languageId of WHITELIST) {
      await mod.ensureMonacoLanguage(languageId)
    }

    expect(importMonacoMock).toHaveBeenCalledTimes(WHITELIST.length)
    expect(mod.findLoadedLanguages().sort()).toEqual([...WHITELIST].sort())
  })

  it('重复调用同一语言只加载一次', async function () {
    const mod = await load()
    await mod.ensureMonacoLanguage('typescript')
    await mod.ensureMonacoLanguage('typescript')
    await mod.ensureMonacoLanguage('typescript')

    expect(importMonacoMock).toHaveBeenCalledTimes(1)
  })

  it('并发调用同一语言复用同一个 Promise（不在加载中重复触发）', async function () {
    let release: (value: unknown) => void = function () {}
    let resolveStarted: () => void = function () {}
    const started = new Promise<void>(function (resolve) {
      resolveStarted = resolve
    })
    importMonacoMock.mockImplementationOnce(function () {
      resolveStarted()
      return new Promise<unknown>(function (resolve) {
        release = resolve
      })
    })

    const mod = await load()
    const first = mod.ensureMonacoLanguage('css')
    await started
    const second = mod.ensureMonacoLanguage('css')

    expect(second).toBe(first)
    expect(importMonacoMock).toHaveBeenCalledTimes(1)

    release({})
    await Promise.all([first, second])
    expect(mod.findLoadedLanguages()).toContain('css')
  })

  it('加载失败只告警、不标记已加载，下一次还能重试', async function () {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {
      return undefined
    })
    importMonacoMock.mockImplementationOnce(function () {
      return Promise.reject(new Error('ipc down'))
    })

    const mod = await load()
    await mod.ensureMonacoLanguage('typescript')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toBe('[monaco-language] 语言贡献加载失败')
    expect(warnSpy.mock.calls[0]?.[1]).toBe('typescript')
    expect(mod.findLoadedLanguages()).not.toContain('typescript')

    // 失败不写 loadedLanguages，所以第二次会重新走一遍加载
    await mod.ensureMonacoLanguage('typescript')
    expect(importMonacoMock).toHaveBeenCalledTimes(2)
    expect(mod.findLoadedLanguages()).toContain('typescript')

    warnSpy.mockRestore()
  })

  it('findLoadedLanguages 返回快照，外部改动不影响内部状态', async function () {
    const mod = await load()
    await mod.ensureMonacoLanguage('yaml')

    const snapshot = mod.findLoadedLanguages()
    snapshot.push('not-a-language')
    expect(mod.findLoadedLanguages()).toEqual(['yaml'])
  })
})
