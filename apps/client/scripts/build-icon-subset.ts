/**
 * 生成 iconify 图标子集：只把仓库里**真正被引用**的图标打进首屏包。
 *
 * 为什么必须这么做：`main.tsx` 原来把 `@iconify/json` 的 mdi / ant-design / lucide
 * 三套**全量**集合 `addCollection` 进内存 —— 3.32 + 0.69 + 0.54 ≈ 4.5 MB JSON，
 * 全在启动路径上（打包后就是那个 9 MB 级的 chunk），与首帧无关的几千个图标一起下载、
 * 解析。实际用到的只有 ~470 个。
 *
 * 做法：扫源码里的 `lucide:xxx` / `mdi:xxx` / `ant-design:xxx` 引用，从官方集合里
 * 按名字裁出来（含别名链：别名指向的父图标一并带上），写成 `src/assets/iconify-subset.json`。
 *
 * 用法：`pnpm icons`（改过图标引用后重跑一次）。忘了跑 = 新图标不显示，
 * 但不会报错 —— 所以它是构建前的一次性步骤，不进 watch。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '../..')
const require = createRequire(import.meta.url)

const SOURCE_DIRS = [
  join(appRoot, 'src'),
  join(repoRoot, 'packages/design/src'),
  join(repoRoot, 'packages/chat/src'),
  join(repoRoot, 'packages/shared/src')
]

const PREFIXES = ['mdi', 'ant-design', 'lucide']
const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.json',
  '.mdx'
])
/** `lucide:plug` / `mdi:account` —— 名字允许数字与中划线 */
const ICON_REF = /(mdi|ant-design|lucide):([a-z0-9][a-z0-9-]*)/g

/** 递归收集源码文件（不进 node_modules / dist） */
function collectFiles(dir: string, out: string[]) {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (error) {
    // 目录不存在 = 该源码目录本就没写图标引用；写错路径则会漏收图标，所以要吭一声
    console.warn('[icons] 跳过无法读取的目录 ' + dir + '：' + String(error))
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectFiles(full, out)
      continue
    }
    const dot = name.lastIndexOf('.')
    if (dot < 0 || !SOURCE_EXT.has(name.slice(dot))) continue
    out.push(full)
  }
}

/** 引用到的图标名，按前缀分组 */
function collectRefs(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>()
  const files: string[] = []
  for (const dir of SOURCE_DIRS) collectFiles(dir, files)
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      // 收集与读取之间的竞态（文件被删）：跳过即可，但别静默
      console.debug('[icons] 跳过无法读取的文件 ' + file + '：' + String(error))
      continue
    }
    let match = ICON_REF.exec(text)
    while (match !== null) {
      const prefix = match[1]
      const name = match[2]
      const bucket = used.get(prefix)
      if (bucket) bucket.add(name)
      else used.set(prefix, new Set([name]))
      match = ICON_REF.exec(text)
    }
  }
  return used
}

/** 别名链：`aliases` 里的一条可能指向父图标，父图标也要带上 */
function subsetCollection(collection: Record<string, unknown>, used: Set<string>) {
  const icons = (collection.icons ?? {}) as Record<string, unknown>
  const aliases = (collection.aliases ?? {}) as Record<string, unknown>
  const pickedIcons: Record<string, unknown> = {}
  const pickedAliases: Record<string, unknown> = {}
  const queue = Array.from(used)
  const seen = new Set<string>()
  const missing: string[] = []
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    if (icons[name] !== undefined) {
      pickedIcons[name] = icons[name]
      continue
    }
    const alias = aliases[name] as { parent?: string } | undefined
    if (alias) {
      pickedAliases[name] = alias
      if (alias.parent) queue.push(alias.parent)
      continue
    }
    missing.push(name)
  }
  const result: Record<string, unknown> = {
    prefix: collection.prefix,
    width: collection.width,
    height: collection.height,
    icons: pickedIcons
  }
  if (collection.info) result.info = collection.info
  if (Object.keys(pickedAliases).length > 0) result.aliases = pickedAliases
  return { result, missing, count: Object.keys(pickedIcons).length + Object.keys(pickedAliases).length }
}

function main() {
  const used = collectRefs()
  const collections: unknown[] = []
  let totalMissing = 0
  for (const prefix of PREFIXES) {
    const jsonPath = require.resolve('@iconify/json/json/' + prefix + '.json')
    const collection = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>
    const names = used.get(prefix) ?? new Set<string>()
    const subset = subsetCollection(collection, names)
    collections.push(subset.result)
    totalMissing += subset.missing.length
    console.log('[icons] ' + prefix + ': 引用 ' + names.size + ' / 收录 ' + subset.count)
    if (subset.missing.length > 0) {
      console.warn('[icons] ' + prefix + ' 里找不到：' + subset.missing.slice(0, 20).join(', '))
    }
  }
  const target = join(appRoot, 'src/assets/iconify-subset.json')
  const text = JSON.stringify(collections)
  writeFileSync(target, text, 'utf8')
  console.log('[icons] 写出 ' + target + '（' + (text.length / 1024).toFixed(1) + ' KB）')
  if (totalMissing > 0) {
    console.warn('[icons] 有 ' + totalMissing + ' 个引用在集合里找不到，检查前缀或名字拼写')
  }
}

main()
