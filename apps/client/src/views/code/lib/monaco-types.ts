/**
 * 把工作区 @types/node 与 tsconfig.json 喂给 Monaco TS worker。
 *
 * Monaco 0.57+：用顶层 `monaco.typescript`（勿用 languages.typescript）。
 * - 注入 @types/node 消除 node:fs / node:url 误报（不再灌整棵 @types）
 * - 读主根 tsconfig.json（含 extends 链），下发 paths / baseUrl / target 等白名单字段
 *
 * **为什么不再是「每次树刷新全量重灌」**（对齐 VS Code 的 ProjectService）：
 * `setExtraLibs(全量)` 会让 TS worker 重建 program 并对所有 model 重新语义检查，
 * 内容一模一样也照跑；`packTypes` 还要把几 MB 字符串过一次 IPC。
 * 现在改成三层指纹：
 *
 * 1. `configFingerprint` = roots + tsconfig 链内容 hash —— 树刷新（保存 / checkout /
 *    外部改动）算出来一样就直接返回，**连 packTypes 都不调用**；
 * 2. `libHandles` 台账 —— 只有新增 / 内容变化的 `.d.ts` 才 `addExtraLib`，
 *    消失的逐条 `dispose()`，不再有「全量替换」；
 * 3. `syncedCompilerKey` = 编译选项的 JSON 指纹 —— 配置没变就不调 `setCompilerOptions`。
 *
 * 装了新包（node_modules/@types 变化）而 tsconfig 没动时，指纹不会变：
 * 走工具条的强制同步（`isForced`）或改一次 tsconfig 即可，代价换来的是
 * 「保存 10 次 = 0 次 program 重建」。
 */
import type * as Monaco from 'monaco-editor'

import { runWhenIdle } from '@/lib/perf/idle.ts'
import { findMonaco, importMonaco } from '@/lib/monaco-loader.ts'
import { WorkspaceFiles } from '@/lib/workspace-files'
import { normalizeSeparators } from '@/views/code/lib/path.ts'
import { readTsconfigChain, toCompilerOptions } from '@/views/code/lib/tsconfig.ts'

const AT_TYPES_MARKER = '/node_modules/@types/'

type MonacoModule = typeof Monaco
type TsCompilerOptions = Parameters<
  MonacoModule['typescript']['typescriptDefaults']['setCompilerOptions']
>[0]
type LibHandle = Monaco.IDisposable

interface SyncOutcome {
  isApplied: boolean
  pathsCount: number
  target: string | null
}

interface SyncOptions {
  /** 强制重来：绕过指纹（用户手动「重载」/ 确认 @types 变了） */
  isForced?: boolean
}

/** 一个虚拟 `.d.ts` 的注入台账：内容 hash + TS / JS 两套 defaults 的 handle */
interface LibEntry {
  readonly hash: string
  readonly handles: readonly LibHandle[]
}

let isCompilerReady = false
/** roots + tsconfig 内容：树刷新是否要重来，只看它 */
let configFingerprint: string | null = null
/** configFingerprint + @types 的 path:size:hash：用于日志与增量判定 */
let syncedFingerprint: string | null = null
let syncedCompilerKey: string | null = null
let syncToken = 0
const libHandles = new Map<string, LibEntry>()

/** djb2：只用来判断「内容变没变」，不承担安全语义 */
function hashContent(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

function typescriptApi() {
  // editor.api 的类型不含 language 命名空间：运行期由语言服务 contribution 注入到同一模块对象上
  const monaco = findMonaco() as unknown as MonacoModule
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

function buildCompilerOptions(
  typeRoots: string[],
  fromTsconfig: Partial<TsCompilerOptions>
): TsCompilerOptions {
  return {
    ...baseCompilerOptions(),
    typeRoots: [...typeRoots, 'node_modules/@types'],
    types: ['node'],
    ...fromTsconfig
  }
}

/** 配置没变就别调：`setCompilerOptions` 会触发 program 重建 */
function pushCompilerOptions(
  typeRoots: string[],
  fromTsconfig: Partial<TsCompilerOptions>
): boolean {
  const options = buildCompilerOptions(typeRoots, fromTsconfig)
  const key = JSON.stringify(options)
  if (key === syncedCompilerKey) return false
  const ts = typescriptApi()
  ts.typescriptDefaults.setCompilerOptions(options)
  ts.javascriptDefaults.setCompilerOptions(options)
  syncedCompilerKey = key
  return true
}

/**
 * 增量注入：新增 / 内容变化 → addExtraLib；消失 → dispose。
 *
 * 内容不变的文件完全不碰，TS worker 因此不会重建 program。
 */
function diffExtraLibs(nextLibs: Map<string, string>): { added: number; removed: number } {
  const ts = typescriptApi()
  let added = 0
  let removed = 0

  for (const [uri, content] of nextLibs) {
    const hash = hashContent(content)
    const existing = libHandles.get(uri)
    if (existing && existing.hash === hash) continue
    if (existing) {
      for (const handle of existing.handles) handle.dispose()
      removed += 1
    }
    const handles: LibHandle[] = [
      ts.typescriptDefaults.addExtraLib(content, uri),
      ts.javascriptDefaults.addExtraLib(content, uri)
    ]
    libHandles.set(uri, { hash, handles })
    added += 1
  }

  for (const [uri, entry] of [...libHandles]) {
    if (nextLibs.has(uri)) continue
    for (const handle of entry.handles) handle.dispose()
    libHandles.delete(uri)
    removed += 1
  }

  return { added, removed }
}

/**
 * 同步一次工作区的 TS 库。
 *
 * `isForced` 绕过指纹（手动重载）；否则 configFingerprint 一致就直接返回。
 */
async function syncWorkspaceTypescriptLibs(
  workspaceRoots: string[],
  options: SyncOptions = {}
): Promise<SyncOutcome> {
  const roots = workspaceRoots
    .map(function (root) {
      return normalizeSeparators(root).replace(/\/+$/, '')
    })
    .filter(Boolean)
  const outcome: SyncOutcome = { isApplied: false, pathsCount: 0, target: null }
  if (roots.length === 0) return outcome

  await importMonaco()
  const token = ++syncToken
  ensureDiagnostics()

  const ts = typescriptApi()

  let chain
  try {
    chain = await readTsconfigChain(roots)
  } catch (error) {
    console.debug('[monaco-types] 读取 tsconfig 链失败，按无配置同步', error)
    chain = null
  }
  if (token !== syncToken) return outcome

  const nextConfigFingerprint = `${roots.join('|')}::${hashContent(JSON.stringify(chain ?? null))}`
  if (options.isForced !== true && nextConfigFingerprint === configFingerprint) {
    // 树刷新（保存 / checkout / 外部改动）走到这里就是零成本返回
    return outcome
  }

  const fromTsconfig = toCompilerOptions(chain ?? null, {
    rootPath: roots[0],
    base: baseCompilerOptions(),
    enums: {
      target: ts.ScriptTarget as unknown as Record<string, number>,
      module: ts.ModuleKind as unknown as Record<string, number>,
      moduleResolution: ts.ModuleResolutionKind as unknown as Record<string, number>,
      jsx: ts.JsxEmit as unknown as Record<string, number>
    }
  })

  // packTypes 是几 MB 的 IPC，排到空闲；期间的过期结果用 token 丢弃
  let packed
  try {
    packed = await runWhenIdle(function () {
      return WorkspaceFiles.packTypes(roots[0])
    })
  } catch (error) {
    console.error('[monaco-types] packTypes 失败', error)
    return outcome
  }
  if (token !== syncToken) return outcome

  const typeRoots = findAtTypesRoots(
    packed.files.map(function (file) {
      return file.path
    })
  )

  const nextLibs = new Map<string, string>()
  for (const file of packed.files) {
    const virtualUri = toVirtualAtTypesUri(file.path)
    if (!virtualUri || nextLibs.has(virtualUri)) continue
    nextLibs.set(virtualUri, file.content)
  }
  const typesFingerprint = [...nextLibs.keys()]
    .sort()
    .map(function (uri) {
      return `${uri}:${hashContent(nextLibs.get(uri) ?? '')}`
    })
    .join('|')

  // 注入本身也是主线程工作（TS worker 侧建 model），同样排到空闲
  const diff = await runWhenIdle(function () {
    const isOptionsApplied = pushCompilerOptions(typeRoots, fromTsconfig)
    const result = diffExtraLibs(nextLibs)
    return { ...result, isOptionsApplied }
  })
  if (token !== syncToken) return outcome

  configFingerprint = nextConfigFingerprint
  syncedFingerprint = `${nextConfigFingerprint}::${hashContent(typesFingerprint)}`

  // 只有「真的改了东西」才算 applied（否则 toast 会在每次导航时重复弹）
  outcome.isApplied = diff.added > 0 || diff.removed > 0 || diff.isOptionsApplied
  outcome.pathsCount =
    fromTsconfig.paths && typeof fromTsconfig.paths === 'object'
      ? Object.keys(fromTsconfig.paths).length
      : 0
  const rawTarget = chain?.compilerOptions?.target
  outcome.target = typeof rawTarget === 'string' ? rawTarget : null

  if (nextLibs.size === 0) {
    console.warn(
      '[monaco-types] 未注入 @types/node。请确认工作区或其上级存在 node_modules/@types/node',
      roots[0]
    )
  } else {
    console.info(
      '[monaco-types] 已注入 @types/node',
      nextLibs.size,
      '个文件',
      typeRoots,
      '（新增',
      diff.added,
      '移除',
      diff.removed,
      '）'
    )
  }
  if (packed.isTruncated) {
    console.warn('[monaco-types] @types/node 仍被截断（异常偏大）', packed.files.length)
  }
  return outcome
}

function resetWorkspaceTypescriptLibs(): void {
  syncToken += 1
  configFingerprint = null
  syncedFingerprint = null
  syncedCompilerKey = null
  if (!isCompilerReady) {
    libHandles.clear()
    return
  }
  for (const entry of libHandles.values()) {
    for (const handle of entry.handles) handle.dispose()
  }
  libHandles.clear()
  pushCompilerOptions([], {})
}

function readSyncedFingerprint(): string | null {
  return syncedFingerprint
}

export { readSyncedFingerprint, resetWorkspaceTypescriptLibs, syncWorkspaceTypescriptLibs }
export type { SyncOptions, SyncOutcome }
