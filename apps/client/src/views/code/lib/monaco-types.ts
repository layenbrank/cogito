/**
 * 把工作区 @types/node 喂给 Monaco TS worker。
 *
 * Monaco 0.57+：用顶层 `monaco.typescript`（勿用 languages.typescript）。
 * 只注入 @types/node + `types: ['node']`，消除 node:fs / node:url 误报；
 * 不再灌整棵 @types（会顶满限额、拖垮 worker）。
 */
import * as monaco from 'monaco-editor'

import { WorkspaceFiles } from '@/lib/workspace-files'
import { normalizeSeparators } from '@/views/code/lib/path.ts'

const AT_TYPES_MARKER = '/node_modules/@types/'

type TsCompilerOptions = Parameters<
  typeof monaco.typescript.typescriptDefaults.setCompilerOptions
>[0]

let isCompilerReady = false
let syncedRoot: string | null = null
let syncToken = 0

function typescriptApi() {
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

function pushCompilerOptions(typeRoots: string[]): void {
  const ts = typescriptApi()
  const options: TsCompilerOptions = {
    ...baseCompilerOptions(),
    typeRoots: [...typeRoots, 'node_modules/@types'],
    types: ['node']
  }
  ts.typescriptDefaults.setCompilerOptions(options)
  ts.javascriptDefaults.setCompilerOptions(options)
}

/** 打开 / 切换工作区时同步一次；同 root 重复调用会跳过 */
async function syncWorkspaceTypescriptLibs(workspaceRoot: string): Promise<void> {
  const root = normalizeSeparators(workspaceRoot).replace(/\/+$/, '')
  if (!root) return
  if (syncedRoot === root) return

  const token = ++syncToken
  ensureDiagnostics()

  let packed
  try {
    packed = await WorkspaceFiles.packTypes(root)
  } catch (error) {
    console.error('[monaco-types] packTypes 失败', error)
    return
  }
  if (token !== syncToken) return

  const typeRoots = findAtTypesRoots(
    packed.files.map(function (file) {
      return file.path
    })
  )
  pushCompilerOptions(typeRoots)

  const libs: { content: string; filePath: string }[] = []
  const seen = new Set<string>()
  for (const file of packed.files) {
    const virtualUri = toVirtualAtTypesUri(file.path)
    if (!virtualUri || seen.has(virtualUri)) continue
    seen.add(virtualUri)
    libs.push({ content: file.content, filePath: virtualUri })
  }

  const ts = typescriptApi()
  ts.typescriptDefaults.setExtraLibs(libs)
  ts.javascriptDefaults.setExtraLibs(libs)
  syncedRoot = root

  if (libs.length === 0) {
    console.warn(
      '[monaco-types] 未注入 @types/node。请确认工作区或其上级存在 node_modules/@types/node',
      root
    )
    return
  }
  console.info('[monaco-types] 已注入 @types/node', libs.length, '个文件', typeRoots)
  if (packed.isTruncated) {
    console.warn('[monaco-types] @types/node 仍被截断（异常偏大）', packed.files.length)
  }
}

function resetWorkspaceTypescriptLibs(): void {
  syncToken += 1
  syncedRoot = null
  if (isCompilerReady) {
    clearLibs()
    pushCompilerOptions([])
  }
}

export { syncWorkspaceTypescriptLibs, resetWorkspaceTypescriptLibs }
