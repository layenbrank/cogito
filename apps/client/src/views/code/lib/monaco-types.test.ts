/**
 * `monaco-types` 的指纹与增量注入。
 *
 * 这组用例替代的是一条手工验收：「连续保存同一 .ts 10 次，`[monaco-types] 已注入`
 * 只打印 1 次」。手工只能看日志，这里直接数 `addExtraLib` / `setCompilerOptions` /
 * `packTypes` 的调用次数 —— 它们才是「TS worker 会不会重建 program」的真正开关。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

interface FakePackFile {
  path: string
  content: string
}

interface FakeHandle {
  dispose: ReturnType<typeof vi.fn>
}

interface FakeDefaults {
  setEagerModelSync: ReturnType<typeof vi.fn>
  setDiagnosticsOptions: ReturnType<typeof vi.fn>
  setCompilerOptions: ReturnType<typeof vi.fn>
  addExtraLib: ReturnType<typeof vi.fn>
}

interface FakeState {
  files: FakePackFile[]
  tsconfig: unknown
  // 显式声明返回类型：`vi.fn()` 的默认签名是 void，返回 Promise 会被判成 no-misused-promises
  packTypes: Mock<(...args: unknown[]) => unknown>
  readTsconfigChain: Mock<(...args: unknown[]) => unknown>
  toCompilerOptions: Mock<(...args: unknown[]) => unknown>
  addExtraLibCalls: { uri: string; defaults: string }[]
}

const state = vi.hoisted(function (): FakeState {
  return {
    files: [],
    tsconfig: null,
    packTypes: vi.fn(),
    readTsconfigChain: vi.fn(),
    toCompilerOptions: vi.fn(),
    addExtraLibCalls: []
  }
})

function makeDefaults(name: string): FakeDefaults {
  const api: FakeDefaults = {
    setEagerModelSync: vi.fn(),
    setDiagnosticsOptions: vi.fn(),
    setCompilerOptions: vi.fn(),
    addExtraLib: vi.fn(function (content: string, uri: string) {
      const handle: FakeHandle = { dispose: vi.fn() }
      state.addExtraLibCalls.push({ uri, defaults: name })
      void content
      return handle
    })
  }
  return api
}

const typescriptDefaults = makeDefaults('ts')
const javascriptDefaults = makeDefaults('js')

const fakeMonaco = {
  typescript: {
    // 0.57 起 ScriptTarget / ModuleKind 等枚举挂在 `monaco.typescript` 上
    ScriptTarget: { ESNext: 99 },
    ModuleKind: { ESNext: 99 },
    ModuleResolutionKind: { NodeJs: 2 },
    JsxEmit: { ReactJSX: 4 },
    typescriptDefaults,
    javascriptDefaults
  }
}

vi.mock('@/lib/monaco-loader.ts', function () {
  return {
    findMonaco: function () {
      return fakeMonaco
    },
    importMonaco: function () {
      return Promise.resolve()
    }
  }
})

vi.mock('@/lib/perf/idle.ts', function () {
  return {
    runWhenIdle: function (task: () => unknown) {
      return Promise.resolve(task())
    }
  }
})

vi.mock('@/lib/workspace-files', function () {
  return { WorkspaceFiles: { packTypes: state.packTypes } }
})

vi.mock('@/views/code/lib/tsconfig.ts', function () {
  return {
    readTsconfigChain: state.readTsconfigChain,
    toCompilerOptions: state.toCompilerOptions
  }
})

import {
  readSyncedFingerprint,
  resetWorkspaceTypescriptLibs,
  syncWorkspaceTypescriptLibs
} from './monaco-types.ts'

const ROOT = 'C:/work/app'

function libFile(name: string, content: string): FakePackFile {
  return { path: `${ROOT}/node_modules/@types/node/${name}`, content }
}

function addExtraLibTotal(): number {
  return state.addExtraLibCalls.length
}

function touchedUris(): string[] {
  return state.addExtraLibCalls.map(function (call) {
    return call.uri
  })
}

describe('monaco-types：指纹与增量注入', function () {
  beforeEach(function () {
    state.files = [libFile('index.d.ts', 'declare const a: 1'), libFile('fs.d.ts', 'declare const b: 2')]
    state.tsconfig = { compilerOptions: { target: 'ES2022' } }
    state.packTypes.mockReset()
    state.packTypes.mockImplementation(function () {
      return Promise.resolve({ files: state.files, isTruncated: false })
    })
    state.readTsconfigChain.mockReset()
    state.readTsconfigChain.mockImplementation(function () {
      return Promise.resolve(state.tsconfig)
    })
    state.toCompilerOptions.mockReset()
    state.toCompilerOptions.mockImplementation(function () {
      return {}
    })
    resetWorkspaceTypescriptLibs()
    state.addExtraLibCalls.length = 0
    typescriptDefaults.addExtraLib.mockClear()
    typescriptDefaults.setCompilerOptions.mockClear()
    javascriptDefaults.addExtraLib.mockClear()
    javascriptDefaults.setCompilerOptions.mockClear()
    state.packTypes.mockClear()
  })

  it('首次同步：每个 .d.ts 各注入 TS / JS 两套 defaults，配置推一次', async function () {
    const outcome = await syncWorkspaceTypescriptLibs([ROOT])

    expect(outcome.isApplied).toBe(true)
    expect(state.packTypes).toHaveBeenCalledTimes(1)
    expect(javascriptDefaults.addExtraLib).toHaveBeenCalledTimes(2)
    expect(typescriptDefaults.addExtraLib).toHaveBeenCalledTimes(2)
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1)
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1)
    expect(touchedUris()).toEqual([
      'file:///node_modules/@types/node/index.d.ts',
      'file:///node_modules/@types/node/index.d.ts',
      'file:///node_modules/@types/node/fs.d.ts',
      'file:///node_modules/@types/node/fs.d.ts'
    ])
    expect(readSyncedFingerprint()).toContain(ROOT)
  })

  it('配置没变：连续 10 次「保存触发同步」只 `packTypes` 1 次、注入 0 次', async function () {
    await syncWorkspaceTypescriptLibs([ROOT])
    state.packTypes.mockClear()
    state.addExtraLibCalls.length = 0

    const outcomes = []
    for (let index = 0; index < 10; index += 1) {
      outcomes.push(await syncWorkspaceTypescriptLibs([ROOT]))
    }

    expect(state.packTypes).toHaveBeenCalledTimes(0)
    expect(addExtraLibTotal()).toBe(0)
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1)
    expect(
      outcomes.every(function (outcome) {
        return outcome.isApplied === false
      })
    ).toBe(true)
  })

  it('tsconfig 内容变化：允许重来，但内容没变的 .d.ts 不重新注入', async function () {
    await syncWorkspaceTypescriptLibs([ROOT])
    state.addExtraLibCalls.length = 0

    state.tsconfig = { compilerOptions: { target: 'ES2020' } }
    const outcome = await syncWorkspaceTypescriptLibs([ROOT])

    expect(state.packTypes).toHaveBeenCalledTimes(2)
    expect(addExtraLibTotal()).toBe(0)
    expect(outcome.isApplied).toBe(false)
  })

  it('isForced：只重灌内容变化的那一个文件，消失的文件 dispose', async function () {
    await syncWorkspaceTypescriptLibs([ROOT])
    state.addExtraLibCalls.length = 0

    state.files = [libFile('index.d.ts', 'declare const a: 1 // changed')]
    const outcome = await syncWorkspaceTypescriptLibs([ROOT], { isForced: true })

    expect(outcome.isApplied).toBe(true)
    expect(addExtraLibTotal()).toBe(2)
    expect(new Set(touchedUris())).toEqual(
      new Set(['file:///node_modules/@types/node/index.d.ts'])
    )
  })

  it('指纹与 roots 绑定：换工作区必然重来（内容一样则不重复注入）', async function () {
    await syncWorkspaceTypescriptLibs([ROOT])
    state.addExtraLibCalls.length = 0

    const outcome = await syncWorkspaceTypescriptLibs(['C:/work/other'])

    expect(state.packTypes).toHaveBeenCalledTimes(2)
    expect(addExtraLibTotal()).toBe(0)
    expect(outcome.isApplied).toBe(false)
  })

  it('reset 之后指纹清空，下一次同步重新注入（工具条「重载」语义）', async function () {
    await syncWorkspaceTypescriptLibs([ROOT])
    state.addExtraLibCalls.length = 0

    resetWorkspaceTypescriptLibs()
    expect(readSyncedFingerprint()).toBeNull()

    const outcome = await syncWorkspaceTypescriptLibs([ROOT])

    expect(outcome.isApplied).toBe(true)
    expect(addExtraLibTotal()).toBe(4)
  })

  it('@types 为空：不注入，且不把「空结果」记成已同步（下次还会试）', async function () {
    state.files = []
    const outcome = await syncWorkspaceTypescriptLibs([ROOT])

    expect(outcome.isApplied).toBe(false)
    expect(addExtraLibTotal()).toBe(0)

    state.files = [libFile('index.d.ts', 'declare const a: 1')]
    const next = await syncWorkspaceTypescriptLibs([ROOT])

    // 配置指纹没变，仍然走零成本返回：要等 tsconfig 变化或强制同步
    expect(next.isApplied).toBe(false)
    expect(state.packTypes).toHaveBeenCalledTimes(1)
  })
})
