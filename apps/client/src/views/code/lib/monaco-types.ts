/**
 * 把工作区 @types/node 与 tsconfig.json 喂给 Monaco TS worker。
 *
 * Monaco 0.57+：用顶层 `monaco.typescript`（勿用 languages.typescript）。
 * - 注入 @types/node 消除 node:fs / node:url 误报（不再灌整棵 @types）
 * - 读主根 tsconfig.json（含 extends 链），下发 paths / baseUrl / target 等白名单字段
 */
import type * as Monaco from 'monaco-editor'

import { findMonaco, importMonaco } from '@/lib/monaco-loader.ts'
import { WorkspaceFiles } from '@/lib/workspace-files'
import { normalizeSeparators } from '@/views/code/lib/path.ts'
import { readTsconfigChain, toCompilerOptions } from '@/views/code/lib/tsconfig.ts'

const AT_TYPES_MARKER = '/node_modules/@types/'

type MonacoModule = typeof Monaco
type TsCompilerOptions = Parameters<
  MonacoModule['typescript']['typescriptDefaults']['setCompilerOptions']
>[0]

interface SyncOutcome {
  isApplied: boolean
  pathsCount: number
  target: string | null
}

let isCompilerReady = false
let syncedKey: string | null = null
let syncToken = 0

function typescriptApi() {
  const monaco = findMonaco()
  const api = monaco.typescript
  if (!api?.typescriptDefaults) {
    throw new Error(
      'monaco.typescript 未就绪。请确认 monaco-editor 0.57+ 根入口，且未误用 languages.typescript'
    )
  }
  return api
}

function baseCompilerOptions(): TsCompilerOptions {
  const ts = typescriptApi()
  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    skipLibCheck: true
  }
}

function ensureDiagnostics(): void {
  if (isCompilerReady) return
  isCompilerReady = true
  const ts = typescriptApi()
  ts.typescriptDefaults.setEagerModelSync(false)
  ts.javascriptDefaults.setEagerModelSync(false)
  const diagnostics = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
    onlyVisible: true
  }
  ts.typescriptDefaults.setDiagnosticsOptions(diagnostics)
  ts.javascriptDefaults.setDiagnosticsOptions(diagnostics)
}

function findAtTypesRoots(filePaths: string[]): string[] {
  const roots = new Set<string>()
  for (const path of filePaths) {
    const normalized = normalizeSeparators(path)
    const index = normalized.toLowerCase().indexOf(AT_TYPES_MARKER)
    if (index < 0) continue
    roots.add(normalized.slice(0, index + AT_TYPES_MARKER.length - 1))
  }
  return [...roots]
}

/** 虚拟路径：配合 typeRoots / types:['node']，比盘符绝对路径更稳 */
function toVirtualAtTypesUri(absolutePath: string): string | null {
  const normalized = normalizeSeparators(absolutePath)
  const index = normalized.toLowerCase().indexOf(AT_TYPES_MARKER)
  if (index < 0) return null
  return `file:///${normalized.slice(index + 1)}`
}

function clearLibs(): void {
  const ts = typescriptApi()
  ts.typescriptDefaults.setExtraLibs([])
  ts.javascriptDefaults.setExtraLibs([])
}

function pushCompilerOptions(
  typeRoots: string[],
  fromTsconfig: Partial<TsCompilerOptions>
): void {
  const ts = typescriptApi()
  const options: TsCompilerOptions = {
    ...baseCompilerOptions(),
    typeRoots: [...typeRoots, 'node_modules/@types'],
    types: ['node'],
    ...fromTsconfig
  }
  ts.typescriptDefaults.setCompilerOptions(options)
  ts.javascriptDefaults.setCompilerOptions(options)
}

/**
 * 打开 / 切换工作区时同步一次。
 * `isForced` 为真时忽略缓存（用户改了 tsconfig.json / 树刷新）。
 */
async function syncWorkspaceTypescriptLibs(
  workspaceRoots: string[],
  isForced = false
): Promise<SyncOutcome> {
  const roots = workspaceRoots
    .map(function (root) {
      return normalizeSeparators(root).replace(/\/+$/, '')
    })
    .filter(Boolean)
  const outcome: SyncOutcome = { isApplied: false, pathsCount: 0, target: null }
  if (roots.length === 0) return outcome

  const key = roots.join('|')
  if (!isForced && syncedKey === key) return outcome

  await importMonaco()
  const token = ++syncToken
  ensureDiagnostics()

  let packed
  try {
    packed = await WorkspaceFiles.packTypes(roots[0])
  } catch (error) {
    console.error('[monaco-types] packTypes 失败', error)
    return outcome
  }
  if (token !== syncToken) return outcome

  const chain = await readTsconfigChain(roots)
  if (token !== syncToken) return outcome

  const ts = typescriptApi()
  const fromTsconfig = toCompilerOptions(chain, {
    rootPath: roots[0],
    base: baseCompilerOptions(),
    enums: {
      target: ts.ScriptTarget as unknown as Record<string, number>,
      module: ts.ModuleKind as unknown as Record<string, number>,
      moduleResolution: ts.ModuleResolutionKind as unknown as Record<string, number>,
      jsx: ts.JsxEmit as unknown as Record<string, number>
    }
  })

  const typeRoots = findAtTypesRoots(
    packed.files.map(function (file) {
      return file.path
    })
  )
  pushCompilerOptions(typeRoots, fromTsconfig)

  const libs: { content: string; filePath: string }[] = []
  const seen = new Set<string>()
  for (const file of packed.files) {
    const virtualUri = toVirtualAtTypesUri(file.path)
    if (!virtualUri || seen.has(virtualUri)) continue
    seen.add(virtualUri)
    libs.push({ content: file.content, filePath: virtualUri })
  }

  ts.typescriptDefaults.setExtraLibs(libs)
  ts.javascriptDefaults.setExtraLibs(libs)
  syncedKey = key

  outcome.isApplied = true
  outcome.pathsCount =
    fromTsconfig.paths && typeof fromTsconfig.paths === 'object'
      ? Object.keys(fromTsconfig.paths).length
      : 0
  const rawTarget = chain?.compilerOptions?.target
  outcome.target = typeof rawTarget === 'string' ? rawTarget : null

  if (libs.length === 0) {
    console.warn(
      '[monaco-types] 未注入 @types/node。请确认工作区或其上级存在 node_modules/@types/node',
      roots[0]
    )
  } else {
    console.info('[monaco-types] 已注入 @types/node', libs.length, '个文件', typeRoots)
  }
  if (packed.isTruncated) {
    console.warn('[monaco-types] @types/node 仍被截断（异常偏大）', packed.files.length)
  }
  return outcome
}

function resetWorkspaceTypescriptLibs(): void {
  syncToken += 1
  syncedKey = null
  if (isCompilerReady) {
    clearLibs()
    pushCompilerOptions([], {})
  }
}

export { syncWorkspaceTypescriptLibs, resetWorkspaceTypescriptLibs }
export type { SyncOutcome }
