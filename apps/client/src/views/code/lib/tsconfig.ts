/**
 * tsconfig.json 读取与 Monaco 编译选项映射。
 *
 * Monaco TS worker 没有磁盘访问权，只能吃 `setCompilerOptions`。这里在主根读
 * `tsconfig.json`，沿 `extends` 链合并（深度 ≤ 3、环检测），再把白名单字段映射成
 * Monaco 的枚举 / `file:///` URI。
 */
import type * as Monaco from 'monaco-editor'

import { WorkspaceFiles } from '@/lib/workspace-files'
import { parseJsonc } from '@/views/code/lib/jsonc.ts'
import { joinPath, normalizeSeparators } from '@/views/code/lib/path.ts'

type MonacoModule = typeof Monaco
type TsCompilerOptions = Parameters<
  MonacoModule['typescript']['typescriptDefaults']['setCompilerOptions']
>[0]

interface RawTsconfig {
  extends?: string | string[]
  compilerOptions?: Record<string, unknown>
}

interface TsconfigEnums {
  target?: Record<string, number>
  module?: Record<string, number>
  moduleResolution?: Record<string, number>
  jsx?: Record<string, number>
}

interface TsconfigApplyInput {
  /** 主根，用于把 baseUrl 拼成 file:/// URI */
  rootPath: string
  base: TsCompilerOptions
  enums?: TsconfigEnums
}

const MAX_EXTENDS_DEPTH = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toRawTsconfig(value: unknown): RawTsconfig | null {
  if (!isRecord(value)) return null
  const config: RawTsconfig = {}
  if (typeof value.extends === 'string') config.extends = value.extends
  if (Array.isArray(value.extends)) {
    config.extends = value.extends.filter(function (item): item is string {
      return typeof item === 'string'
    })
  }
  if (isRecord(value.compilerOptions)) config.compilerOptions = value.compilerOptions
  return config
}

/** 相对路径归一化：消掉 `./` 与 `../` */
function normalizeRelativePath(path: string): string {
  const segments = normalizeSeparators(path).split('/')
  const stack: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return stack.join('/')
}

/** extends 目标 → 相对主根的配置路径 */
function resolveExtendsPath(currentPath: string, target: string): string {
  if (target.startsWith('./') || target.startsWith('../') || target.startsWith('/')) {
    const normalizedCurrent = normalizeSeparators(currentPath)
    const slash = normalizedCurrent.lastIndexOf('/')
    const dir = slash < 0 ? '' : normalizedCurrent.slice(0, slash)
    const relative = target.startsWith('/') ? target.slice(1) : dir ? `${dir}/${target}` : target
    const normalized = normalizeRelativePath(relative)
    return normalized.endsWith('.json') ? normalized : `${normalized}.json`
  }
  const packagePath = `node_modules/${target}`
  return packagePath.endsWith('.json') ? packagePath : `${packagePath}/tsconfig.json`
}

async function readConfig(
  roots: string[],
  relativePath: string
): Promise<RawTsconfig | null> {
  try {
    const result = await WorkspaceFiles.readFile(roots, joinPath(roots[0], relativePath))
    const parsed = parseJsonc(result.content)
    if (!parsed.ok) {
      console.warn('[tsconfig] 解析失败', relativePath, parsed.reason)
      return null
    }
    return toRawTsconfig(parsed.value)
  } catch (error) {
    console.debug('[tsconfig] 读取失败', relativePath, error)
    return null
  }
}

async function readChain(
  roots: string[],
  relativePath: string,
  depth: number,
  visited: Set<string>
): Promise<RawTsconfig | null> {
  const key = normalizeSeparators(relativePath).toLowerCase()
  if (visited.has(key) || depth > MAX_EXTENDS_DEPTH) return null
  visited.add(key)

  const current = await readConfig(roots, relativePath)
  if (!current) return null

  const parentTargets = Array.isArray(current.extends)
    ? current.extends
    : current.extends
      ? [current.extends]
      : []
  let merged: RawTsconfig = {}
  for (const target of parentTargets) {
    const parentPath = resolveExtendsPath(relativePath, target)
    const parent = await readChain(roots, parentPath, depth + 1, visited)
    if (parent) merged = mergeTsconfig(merged, parent)
  }
  return mergeTsconfig(merged, current)
}

/** 子配置覆盖父配置；compilerOptions 浅合并（`paths` 整对象替换） */
function mergeTsconfig(parent: RawTsconfig, child: RawTsconfig): RawTsconfig {
  return {
    ...parent,
    ...child,
    compilerOptions: {
      ...(parent.compilerOptions ?? {}),
      ...(child.compilerOptions ?? {})
    }
  }
}

/** 主根 tsconfig.json（含 extends 链）；不存在 / 非法返回 null */
async function readTsconfigChain(roots: string[]): Promise<RawTsconfig | null> {
  const root = roots[0]
  if (!root) return null
  return readChain(roots, 'tsconfig.json', 0, new Set<string>())
}

function toFileUri(path: string): string {
  const normalized = normalizeSeparators(path).replace(/\/+$/, '')
  const withSlash = /^[a-zA-Z]:\//.test(normalized) ? `/${normalized}` : normalized
  return `file://${encodeURI(withSlash)}`
}

/** baseUrl 相对 tsconfig 所在目录解析，输出 file:/// URI */
function resolveBaseUrl(rootPath: string, baseUrl: string): string {
  const base = normalizeRelativePath(`${normalizeSeparators(rootPath)}/${normalizeSeparators(baseUrl)}`)
  return toFileUri(base)
}

function pickEnum(
  value: unknown,
  table: Record<string, number> | undefined
): number | undefined {
  if (typeof value !== 'string' || !table) return undefined
  const key = value.replace(/[\s-]/g, '').toUpperCase()
  return table[key]
}

/**
 * 纯函数：把合并后的 tsconfig 映射成 Monaco CompilerOptions。
 * 未知字段 / 未知枚举一律忽略，只覆盖白名单。
 */
function toCompilerOptions(
  tsconfig: RawTsconfig | null,
  input: TsconfigApplyInput
): Partial<TsCompilerOptions> {
  const raw = tsconfig?.compilerOptions
  if (!raw) return {}
  const enums = input.enums ?? {}
  const next: Record<string, unknown> = {}

  const target = pickEnum(raw.target, enums.target)
  if (target !== undefined) next.target = target
  const module = pickEnum(raw.module, enums.module)
  if (module !== undefined) next.module = module
  const moduleResolution = pickEnum(raw.moduleResolution, enums.moduleResolution)
  if (moduleResolution !== undefined) next.moduleResolution = moduleResolution
  const jsx = pickEnum(raw.jsx, enums.jsx)
  if (jsx !== undefined) next.jsx = jsx

  if (Array.isArray(raw.lib)) {
    const lib = raw.lib.filter(function (item): item is string {
      return typeof item === 'string'
    })
    if (lib.length > 0) next.lib = lib
  }
  if (Array.isArray(raw.types)) {
    const types = raw.types.filter(function (item): item is string {
      return typeof item === 'string'
    })
    if (types.length > 0) next.types = types
  }

  for (const key of [
    'strict',
    'noImplicitAny',
    'experimentalDecorators',
    'allowJs',
    'checkJs',
    'resolveJsonModule',
    'esModuleInterop',
    'allowSyntheticDefaultImports'
  ] as const) {
    if (typeof raw[key] === 'boolean') next[key] = raw[key]
  }

  if (typeof raw.baseUrl === 'string' && raw.baseUrl.trim()) {
    next.baseUrl = resolveBaseUrl(input.rootPath, raw.baseUrl.trim())
  }
  if (isRecord(raw.paths)) {
    const paths: Record<string, string[]> = {}
    for (const [alias, targets] of Object.entries(raw.paths)) {
      if (!Array.isArray(targets)) continue
      paths[alias] = targets.filter(function (item): item is string {
        return typeof item === 'string'
      })
    }
    if (Object.keys(paths).length > 0) next.paths = paths
  }

  return next as Partial<TsCompilerOptions>
}

export {
  readTsconfigChain,
  readChain,
  resolveExtendsPath,
  resolveBaseUrl,
  toCompilerOptions,
  mergeTsconfig,
  toRawTsconfig
}
export type { RawTsconfig, TsconfigEnums, TsconfigApplyInput }
