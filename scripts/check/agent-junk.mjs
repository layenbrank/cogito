#!/usr/bin/env node
/**
 * 仓库根垃圾检查：拦住「agent 把临时文件落在仓库根」这一类误落。
 *
 * 为什么需要它：`AGENTS.md` 只写了「临时文件一律写缓存目录」，但没有任何东西执行它 ——
 * 于是 `.bat` / `.log` / `scratch-*.ps1` 会留在仓库根，脏 `git status` 还容易被误提交。
 * 缓存目录的真实落点由 `apps/client/src-tauri/src/utils/agent_cache.rs` 决定，
 * 终端里 `$env:COGITO_AGENT_CACHE` / `$env:TEMP` 都指向它。
 *
 * 只查**顶层**：子目录里的产物归各包的 `.gitignore` 与构建配置管，这里只管「根目录被当草稿纸」。
 * 顶层出现 `tmp/` `.tmp/` `temp/` `scratch` 前缀的目录这类草稿区，或 `*.log` `*.bat` `*.ps1`
 * `*.raw` `*.out` `scratch-*` 这类临时文件，就非零退出并逐个点名。
 *
 * 用法：`node scripts/check/agent-junk.mjs [root]`（root 省略时用仓库根，便于测试）
 */
import { readdirSync } from 'node:fs'
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

const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT
const found = collect(target)

if (found.length === 0) {
  console.log(`✓ 仓库根干净（${slash(target)}）`)
  process.exit(0)
}

console.error(`✗ 仓库根出现临时文件（${found.length} 项）：`)
for (const path of found) {
  console.error(`  ${path}`)
}
console.error('')
console.error('这些应该写到 agent 缓存目录：终端里 $env:COGITO_AGENT_CACHE 已指向会话目录')
console.error('（%LOCALAPPDATA%\\cogito\\agent-cache\\<session>，默认保留 7 天）。')
console.error('仓库根只放产品代码与文档；清掉后重跑 pnpm check:agent-junk。')
process.exit(1)
