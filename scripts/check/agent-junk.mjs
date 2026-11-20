#!/usr/bin/env node
/**
 * 仓库垃圾检查：拦住两类「agent / 工具链把产物落在了不该落的地方」。
 *
 * 为什么需要它：`AGENTS.md` 只写了「临时文件一律写缓存目录」，但没有任何东西执行它 ——
 * 于是 `.bat` / `.log` / `scratch-*.ps1` 会留在仓库根，脏 `git status` 还容易被误提交。
 * 缓存目录的真实落点由 `apps/client/src-tauri/src/utils/agent_cache.rs` 决定，
 * 终端里 `$env:COGITO_AGENT_CACHE` / `$env:TEMP` 都指向它。
 *
 * 两条规则：
 *
 * 1. **仓库根不当草稿纸**（只查顶层）：顶层出现 `tmp/` `.tmp/` `temp/` `scratch` 这类草稿区目录，
 *    或 `*.log` `*.bat` `*.ps1` `*.raw` `*.out` `scratch-*` 这类临时文件，就非零退出并逐个点名。
 *    子目录里的产物归各包的 `.gitignore` 与构建配置管。
 * 2. **源码树里没有与 `.ts` / `.tsx` 同名的 `.js`**：那是编译器把产物落在了源码目录。
 *    比脏更糟的是它会被优先解析到 —— Vite 的 `resolve.extensions` 里 `.js` 排在 `.ts` 之前，
 *    ESLint 找配置也是 `eslint.config.js` 先于 `.ts`，于是测试与 lint 静默跑旧代码。
 *    构建侧该用 `noEmit`，再补 `outDir` 兜底（产物只该落 `node_modules/.tmp`）。
 *
 * 用法：`node scripts/check/agent-junk.mjs [root]`（root 省略时用仓库根，便于测试）
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, '..', '..')

/** 顶层目录名：整个目录都算草稿区 */
const JUNK_DIRS = new Set(['tmp', '.tmp', 'temp', '.temp', 'scratch', '.scratch', 'scratchpad'])

/** 顶层文件名模式：命中即算临时文件 */
const JUNK_FILES = [
  /\.log$/i,
  /\.bat$/i,
  /\.cmd$/i,
  /\.ps1$/i,
  /\.raw$/i,
  /\.out$/i,
  /\.tmp$/i,
  /^scratch[-_.]/i,
  /^tmp[-_.]/i,
  /^untitled/i
]

/** 草稿目录里最多列多少个文件（避免一次刷屏，超出的只报目录） */
const MAX_FILES_PER_DIR = 20

function slash(path) {
  return path.replaceAll('\\', '/')
}

function collectFromDir(root, dir) {
  const files = []
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_PER_DIR) return
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        files.push(slash(relative(root, full)))
      }
    }
  }
  walk(dir)
  return files
}

function collect(root) {
  const found = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!JUNK_DIRS.has(entry.name)) continue
      const dir = join(root, entry.name)
      const files = collectFromDir(root, dir)
      // 空目录也要报：本身就是草稿区
      found.push(...(files.length > 0 ? files : [slash(relative(root, dir))]))
      continue
    }
    if (JUNK_FILES.some((pattern) => pattern.test(entry.name))) {
      found.push(slash(relative(root, entry.name)))
    }
  }
  return found
}

/** 走源码树找「同名 .js」时用的顶层目录 */
const SOURCE_ROOTS = ['apps', 'packages', 'scripts']

/**
 * 走源码树时跳过的目录名：依赖、构建产物、生成物、移动端原生工程。
 * 这些地方同名 `.js` 是正常的（别人发布的 JS 配同名类型声明也算这种）。
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-ssr',
  'dist-electron',
  'build',
  'out',
  'release',
  'coverage',
  'test-results',
  'playwright-report',
  '.turbo',
  '.vite',
  '.vitest',
  '.cache',
  '.git',
  '.wrangler',
  '.expo',
  'target',
  'public',
  'ios',
  'android'
])

/** 有同名源码就算「编译产物」的后缀 */
const SOURCE_SUFFIXES = ['.ts', '.tsx', '.mts', '.cts']

/** 同名 .js 最多列多少个（刷屏没意义，数量本身已经是信号） */
const MAX_STRAY_REPORT = 40

/**
 * 源码树里与 `.ts` / `.tsx` 同名的 `.js`。
 *
 * `noEmit` 只在编译器听话时有效：一次 `tsc --build`（旧工具链、或命令行覆盖成
 * `--noEmit false`）就能把它们写回源码树。危害不在脏而在**被优先解析**：
 * Vite 的 `resolve.extensions` 里 `.js` 排在 `.ts` 之前，无扩展名 import 会解析到产物；
 * ESLint 找配置也是 `eslint.config.js` 先于 `.ts`。两边都会静默跑旧代码。
 */
function collectStrayJs(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_STRAY_REPORT) return
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name))
        continue
      }
      if (!entry.name.endsWith('.js')) continue
      const stem = entry.name.slice(0, -'.js'.length)
      const hasSource = SOURCE_SUFFIXES.some((suffix) => existsSync(join(dir, `${stem}${suffix}`)))
      if (!hasSource) continue
      found.push(slash(relative(root, join(dir, entry.name))))
    }
  }
  for (const top of SOURCE_ROOTS) {
    const dir = join(root, top)
    if (existsSync(dir)) walk(dir)
  }
  return found
}

const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT
const junk = collect(target)
const strayJs = collectStrayJs(target)

if (junk.length === 0 && strayJs.length === 0) {
  console.log(`✓ 仓库干净（${slash(target)}）：根目录无草稿、源码树无同名 .js`)
  process.exit(0)
}

if (junk.length > 0) {
  console.error(`✗ 仓库根出现临时文件（${junk.length} 项）：`)
  for (const path of junk) {
    console.error(`  ${path}`)
  }
  console.error('')
  console.error('这些应该写到 agent 缓存目录：终端里 $env:COGITO_AGENT_CACHE 已指向会话目录')
  console.error('（%LOCALAPPDATA%\\cogito\\agent-cache\\<session>，默认保留 7 天）。')
  console.error('仓库根只放产品代码与文档。')
  console.error('')
}

if (strayJs.length > 0) {
  console.error(`✗ 源码树里出现与 .ts / .tsx 同名的 .js（${strayJs.length} 项）：`)
  for (const path of strayJs) {
    console.error(`  ${path}`)
  }
  console.error('')
  console.error('这是编译器把产物落在了源码目录。`.js` 会被优先解析到：')
  console.error('Vite 的 resolve.extensions 里 .js 排在 .ts 之前，ESLint 找配置也是 eslint.config.js')
  console.error('先于 .ts —— 测试与 lint 会静默跑旧代码。删掉它们，构建侧用 noEmit / outDir 兜底。')
  console.error('')
}

console.error('清掉后重跑 pnpm check:agent-junk。')
process.exit(1)
