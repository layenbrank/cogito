/**
 * 把 agentd 打成 **单文件 SEA**（Node Single Executable Application）。
 *
 * 为什么要 SEA 而不是「带 node_modules 的目录」：
 * - sidecar 契约要求 `externalBin` 里是一个可执行文件（Tauri 只 copy 一个）；
 * - 用户机器上没有 node，也不该要求有；
 * - 一个文件的好处是校验/签名/卸载都是原子的。
 *
 * 三个必须记住的约束（S2 spike 实测）：
 * 1. **入口必须是 CJS**。SEA 只按 CJS 跑主脚本，ESM 入口会报
 *    `SyntaxError: Cannot use import statement outside a module`（栈在 `embedderRunCjs`）；
 * 2. **`useCodeCache` 必须 false**，否则 `node --experimental-sea-config` 报
 *    `Cannot generate V8 code cache`（我们不是从 snapshot 起，缓存无处落）；
 * 3. `process.isSea` 在 Node 24.18 里是 `undefined` —— 判 SEA 要用构建期常量。
 *
 * 产物：`<client>/src-tauri/binaries/agentd-<triple>[.exe]`，与其它侧车同目录同命名，
 * 于是 `prepare-binaries.ts` / `externalBin` / `shell().sidecar("agentd")` 都不用特判。
 *
 * 用法：
 *   pnpm --filter @cogito/agentd build:sea        # 完整构建（rolldown + blob + 注入）
 *   node scripts/build-sea.mjs --out <dir>        # 自定义落盘目录
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const AGENTD_DIR = path.resolve(SCRIPT_DIR, '..')
const WORKSPACE_DIR = path.resolve(AGENTD_DIR, '../..')

const BUNDLE = path.join(AGENTD_DIR, 'dist', 'main.cjs')
const BLOB = path.join(AGENTD_DIR, 'dist', 'agentd.blob')
const SEA_CONFIG = path.join(AGENTD_DIR, 'sea-config.json')
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
const LOG_PREFIX = '[agentd:sea]'

/** 当前构建目标的 Rust triple（与 `prepare-binaries.ts` 的 hostTriple 同规则）。 */
function hostTriple() {
  const override =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.CARGO_BUILD_TARGET?.trim()
  if (override) return override
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

/** 包的安装目录（从入口向上找到最近的 package.json）。 */
function packageRootDir(name) {
  let dir = path.dirname(require.resolve(name))
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`${LOG_PREFIX} 找不到 ${name} 的 package.json`)
    dir = parent
  }
}

/** 包内的 CLI 脚本。
 *
 * **不要**用 `node_modules/.bin/*.cmd`：Windows 上 `.cmd` 不能被 execFileSync 直接执行，
 * 非得绕一层 shell；而 `require.resolve('pkg/bin/x.mjs')` 又被 `exports` 挡住。
 */
function packageCli(name, relative) {
  const resolved = path.join(packageRootDir(name), relative)
  if (!existsSync(resolved)) throw new Error(`${LOG_PREFIX} 找不到 ${name}/${relative}`)
  return resolved
}

function parseOutDir() {
  const index = process.argv.indexOf('--out')
  const raw = index >= 0 ? process.argv[index + 1] : undefined
  return raw ? path.resolve(raw) : path.join(WORKSPACE_DIR, 'apps', 'client', 'src-tauri', 'binaries')
}

/** ① rolldown 出 CJS bundle */
function bundle() {
  console.log(`${LOG_PREFIX} 打包 dist/main.cjs`)
  execFileSync(
    process.execPath,
    [
      packageCli('rolldown', 'bin/cli.mjs'),
      'src/main.ts',
      '-o',
      'dist/main.cjs',
      '-f',
      'cjs',
      '--platform',
      'node'
    ],
    { cwd: AGENTD_DIR, stdio: 'inherit' }
  )
  if (!existsSync(BUNDLE)) throw new Error(`${LOG_PREFIX} 未生成 ${BUNDLE}`)
}

/** ② `node --experimental-sea-config` 出注入用 blob */
function buildBlob() {
  if (existsSync(BLOB)) rmSync(BLOB)
  console.log(`${LOG_PREFIX} 生成 SEA blob`)
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
    cwd: AGENTD_DIR,
    stdio: 'inherit'
  })
  if (!existsSync(BLOB)) throw new Error(`${LOG_PREFIX} 未生成 ${BLOB}`)
}

/** ③ 复制 node 自身 + postject 注入 */
function inject(outFile) {
  console.log(`${LOG_PREFIX} 注入 blob → ${outFile}`)
  copyFileSync(process.execPath, outFile)
  // macOS 的 node 是**签名过**的：复制 + 改段之后签名失效，内核直接 SIGKILL（arm64 更严）。
  // 必须先摘签名再注入。注入完的 ad-hoc 重签放在 main() 里做。
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', outFile], { stdio: 'inherit' })
  }
  execFileSync(
    process.execPath,
    [
      require.resolve('postject/dist/cli.js'),
      outFile,
      'NODE_SEA_BLOB',
      BLOB,
      '--sentinel-fuse',
      SENTINEL
    ],
    { stdio: 'inherit' }
  )
  // ad-hoc 重签（`-s -`）：没有开发者证书也能跑，够 CI 校验用。
  // 真分发包由 Tauri 打包时统一重签，这一步不影响它。
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--sign', '-', outFile], { stdio: 'inherit' })
  }
}

function main() {
  const triple = hostTriple()
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const outDir = parseOutDir()
  const outFile = path.join(outDir, `agentd-${triple}${suffix}`)

  mkdirSync(outDir, { recursive: true })
  bundle()
  buildBlob()
  inject(outFile)

  const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1)
  console.log(`${LOG_PREFIX} 完成 ${outFile}（${sizeMb} MB，triple=${triple}）`)
}

main()
