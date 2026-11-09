/**
 * `@types/node` 注入的档位判定（`mode: 'full' | 'lean' | 'off'`）。
 *
 * 这里锁的是「值不值得读那几 MB」：默认 `lean` 只在有 `node:` import 或 tsconfig 声明
 * `types: ['node']` 时才 `packTypes`；`off` 要把已注入的清空且不再读盘。档位也进指纹，
 * 所以切档不需要额外 `isForced` 就能生效。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

interface FakeModelSpec {
  languageId: string
  /** 有 text 的模型才会暴露 `getValue`：模拟「真实打开的 .ts 文件」 */
  text?: string
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
  models: FakeModelSpec[]
  tsconfig: unknown
  packTypes: Mock<(...args: unknown[]) => unknown>
  libs: Map<string, FakeHandle>
  injectedUris: string[]
}

const state = vi.hoisted(function (): FakeState {
  return {
    models: [],
    tsconfig: null,
    packTypes: vi.fn(),
    libs: new Map(),
    injectedUris: []
  }
})

function makeDefaults(): FakeDefaults {
  const api: FakeDefaults = {
    setEagerModelSync: vi.fn(),
    setDiagnosticsOptions: vi.fn(),
    setCompilerOptions: vi.fn(),
    addExtraLib: vi.fn(function (_content: string, uri: string) {
      const handle: FakeHandle = { dispose: vi.fn() }
      state.libs.set(uri, handle)
      state.injectedUris.push(uri)
      return handle
    })
  }
  return api
}

const typescriptDefaults = makeDefaults()
const javascriptDefaults = makeDefaults()

const fakeMonaco = {
  editor: {
    getModels: function () {
      return state.models.map(function (spec) {
        const model: { getLanguageId(): string; getValue?: () => string } = {
          getLanguageId: function () {
            return spec.languageId
          }
        }
        if (typeof spec.text === 'string') {
          const text = spec.text
          model.getValue = function () {
            return text
          }
        }
        return model
      })
    }
  },
  typescript: {
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
    readTsconfigChain: function () {
      return Promise.resolve(state.tsconfig)
    },
    toCompilerOptions: function () {
      return {}
    }
  }
})

import { resetWorkspaceTypescriptLibs, syncWorkspaceTypescriptLibs } from './monaco-types.ts'

const ROOT = 'C:/work/app'
const NODE_TYPES_URI = 'file:///node_modules/@types/node/index.d.ts'

function nodeChunk(): {
  files: { path: string; content: string }[]
  isTruncated: boolean
  total: number
  nextOffset: number
} {
  return {
    files: [{ path: `${ROOT}/node_modules/@types/node/index.d.ts`, content: 'declare const a: 1' }],
    isTruncated: false,
    total: 1,
    nextOffset: 1
  }
}

describe('monaco-types：@types 注入档位', function () {
  beforeEach(function () {
    state.models = [{ languageId: 'typescript', text: 'const total = 1\n' }]
    state.tsconfig = { compilerOptions: { target: 'ES2022' } }
    state.packTypes.mockReset()
    state.packTypes.mockImplementation(function () {
      return Promise.resolve(nodeChunk())
    })
    state.libs.clear()
    state.injectedUris.length = 0
    typescriptDefaults.addExtraLib.mockClear()
    javascriptDefaults.addExtraLib.mockClear()
    typescriptDefaults.setCompilerOptions.mockClear()
    javascriptDefaults.setCompilerOptions.mockClear()
    resetWorkspaceTypescriptLibs()
  })

  it('lean（默认）：模型里没有 node: 就不读盘', async function () {
    const outcome = await syncWorkspaceTypescriptLibs([ROOT], { mode: 'lean' })

    expect(state.packTypes).not.toHaveBeenCalled()
    expect(state.injectedUris).toEqual([])
    // 编译选项仍会推一次（首次），所以只看「有没有真的灌库」
    expect(outcome.target).toBe('ES2022')
  })

  it('lean：模型里出现 node: import 才注入', async function () {
    state.models = [{ languageId: 'typescript', text: "import fs from 'node:fs'\n" }]

    const outcome = await syncWorkspaceTypescriptLibs([ROOT], { mode: 'lean' })

    expect(state.packTypes).toHaveBeenCalledTimes(1)
    // 分块协议：root + offset 0 + 每块 64 个
    expect(state.packTypes).toHaveBeenCalledWith(ROOT, 0, 64)
    expect(state.injectedUris.filter((uri) => uri === NODE_TYPES_URI)).toHaveLength(2)
    expect(outcome.isApplied).toBe(true)
  })

  it('lean：tsconfig 声明 types 含 node 也注入', async function () {
    state.tsconfig = { compilerOptions: { types: ['node', 'vite/client'] } }

    await syncWorkspaceTypescriptLibs([ROOT], { mode: 'lean' })

    expect(state.packTypes).toHaveBeenCalledTimes(1)
  })

  it('full：没有 node 需求也注入', async function () {
    await syncWorkspaceTypescriptLibs([ROOT], { mode: 'full' })

    expect(state.packTypes).toHaveBeenCalledTimes(1)
    expect(state.injectedUris.length).toBeGreaterThan(0)
  })

  it('off：清掉已注入的 extraLibs，且不再 packTypes', async function () {
    await syncWorkspaceTypescriptLibs([ROOT], { mode: 'full' })
    const injectedBefore = state.libs.size
    expect(injectedBefore).toBeGreaterThan(0)
    state.packTypes.mockClear()

    await syncWorkspaceTypescriptLibs([ROOT], { mode: 'off' })

    expect(state.packTypes).not.toHaveBeenCalled()
    const handles = [...state.libs.values()]
    for (const handle of handles) {
      expect(handle.dispose).toHaveBeenCalled()
    }
  })

  it('档位进指纹：同一 tsconfig 下 lean → full 会重新注入（不被 early-return 吃掉）', async function () {
    await syncWorkspaceTypescriptLibs([ROOT], { mode: 'lean' })
    expect(state.packTypes).not.toHaveBeenCalled()

    const outcome = await syncWorkspaceTypescriptLibs([ROOT], { mode: 'full' })

    expect(state.packTypes).toHaveBeenCalledTimes(1)
    expect(outcome.isApplied).toBe(true)
  })

  it('没有 TS / JS 模型（提交历史 / 差异层）时一律不读盘', async function () {
    state.models = [{ languageId: 'markdown', text: "import fs from 'node:fs'" }]

    const outcome = await syncWorkspaceTypescriptLibs([ROOT], { mode: 'full' })

    expect(state.packTypes).not.toHaveBeenCalled()
    expect(outcome.isApplied).toBe(false)
  })
})
