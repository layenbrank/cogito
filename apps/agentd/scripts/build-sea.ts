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
 *   node scripts/build-sea.ts --out <dir>         # 自定义落盘目录
 */

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
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
/** 构建中间文件后缀：`agentd-x.exe.staging-<pid>` / `agentd-x.exe.old-<ts>` */
const STAGING_TAG = '.staging-'
const DISPLACED_TAG = '.old-'
/** 超过这个年龄的中间文件视为遗留（还在被跑的删不掉，下次再来） */
const STALE_MS = 10 * 60 * 1000

/** 当前构建目标的 Rust triple（与 `prepare-binaries.ts` 的 hostTriple 同规则）。 */
function hostTriple(): string {
  const override =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.CARGO_BUILD_TARGET?.trim()
  if (override) return override
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  return `${arch}-unknown-linux-gnu`
}

/** 包的安装目录（从入口向上找到最近的 package.json）。 */
function packageRootDir(name: string): string {
  let dir = path.dirname(require.resolve(name))
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`${LOG_PREFIX} 找不到 ${name} 的 package.json`)
    dir = parent
  }
}

/**
 * 包内的 CLI 脚本。
 *
 * **不要**用 `node_modules/.bin/*.cmd`：Windows 上 `.cmd` 不能被 execFileSync 直接执行，
 * 非得绕一层 shell；而 `require.resolve('pkg/bin/x.mjs')` 又被 `exports` 挡住。
 */
function packageCli(name: string, relative: string): string {
  const resolved = path.join(packageRootDir(name), relative)
  if (!existsSync(resolved)) throw new Error(`${LOG_PREFIX} 找不到 ${name}/${relative}`)
  return resolved
}

function parseOutDir(argv: readonly string[]): string {
  const index = argv.indexOf('--out')
  const raw = index >= 0 ? argv[index + 1] : undefined
  return raw
    ? path.resolve(raw)
    : path.join(WORKSPACE_DIR, 'apps', 'client', 'src-tauri', 'binaries')
}

/** ① rolldown 出 CJS bundle */
function bundle(): void {
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
function buildBlob(): void {
  if (existsSync(BLOB)) rmSync(BLOB)
  console.log(`${LOG_PREFIX} 生成 SEA blob`)
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
    cwd: AGENTD_DIR,
    stdio: 'inherit'
  })
  if (!existsSync(BLOB)) throw new Error(`${LOG_PREFIX} 未生成 ${BLOB}`)
}

/** 从任意抛出来的东西里取 errno（`unknown` 收窄，别用 `as any`）。 */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** `binaries/agentd-*` 正被运行中的应用占用时，给一句能照做的话而不是一个 errno。 */
function explainLocked(error: unknown, outFile: string): unknown {
  const code = errorCode(error)
  if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') return error
  return new Error(
    `${LOG_PREFIX} 无法写入 ${outFile}：文件正被占用。\n` +
      '  构建会先把旧产物改名挪开再换新的（运行中的 exe 只能改名、不能覆盖）；\n' +
      '  连改名都失败说明句柄不是普通运行态（杀软扫描 / 目录被别的东西占着）。\n' +
      '  先**完全退出** cogito 桌面端（agentd 是它的侧车，会被一起收掉）再重试。\n' +
      '  排查残留：Get-Process agentd* , cogito* ，必要时 taskkill /IM cogito.exe /T /F'
  )
}

/**
 * 把旧产物挪开，返回挪走后的路径（本来就不存在则 `undefined`）。
 *
 * Windows 上**运行中的 exe 不能被覆盖或删除，但可以被改名**：改名不动文件内容，
 * 正在跑的那个进程继续用着原来那份映像（句柄跟的是文件对象，不是路径）。
 * 所以「边跑 dev 边重新打包」不必先退出桌面端 —— 新产物落到原路径，
 * 下次拉起侧车（重启 dev / 重启应用）就是新的了。
 */
function displace(outFile: string): string | undefined {
  if (!existsSync(outFile)) return undefined
  const displaced = `${outFile}${DISPLACED_TAG}${Date.now()}`
  try {
    renameSync(outFile, displaced)
    return displaced
  } catch (error) {
    throw explainLocked(error, outFile)
  }
}

/**
 * 上次构建在「挪开旧产物 → 换上新产物」之间被打断时，目标路径会空着。
 * 这里把最近一份被挪走的旧产物还回原位，避免一次 Ctrl+C 就把侧车弄丢。
 */
function restoreDisplaced(outFile: string): void {
  if (existsSync(outFile)) return
  const dir = path.dirname(outFile)
  const prefix = `${path.basename(outFile)}${DISPLACED_TAG}`
  const displaced = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort()
  const newest = displaced[displaced.length - 1]
  if (!newest) return
  const from = path.join(dir, newest)
  try {
    renameSync(from, outFile)
    console.log(`${LOG_PREFIX} 上次构建被打断，已把旧产物还原 → ${outFile}`)
  } catch (error) {
    console.warn(`${LOG_PREFIX} 旧产物 ${from} 还原失败（可手动改名回 ${outFile}）`, error)
  }
}

/** 清掉上次构建遗留的中间文件；还占着句柄的删不掉，跳过。 */
function sweepStale(outDir: string): void {
  const now = Date.now()
  for (const name of readdirSync(outDir)) {
    if (!name.includes(STAGING_TAG) && !name.includes(DISPLACED_TAG)) continue
    const file = path.join(outDir, name)
    try {
      if (now - statSync(file).mtimeMs < STALE_MS) continue
      rmSync(file, { force: true })
    } catch {
      // 句柄还在（桌面端正跑着这份）：留给下次构建
    }
  }
}

/** ③ 复制 node 自身 + postject 注入，成功后再整体换到目标路径 */
function inject(outFile: string): void {
  console.log(`${LOG_PREFIX} 注入 blob → ${outFile}`)
  // 先在旁边做一份完整的：中途失败时旧产物还在，不会留下半截 exe。
  const staged = `${outFile}${STAGING_TAG}${process.pid}`
  if (existsSync(staged)) rmSync(staged, { force: true })
  try {
    copyFileSync(process.execPath, staged)
  } catch (error) {
    throw explainLocked(error, staged)
  }
  // macOS 的 node 是**签名过**的：复制 + 改段之后签名失效，内核直接 SIGKILL（arm64 更严）。
  // 必须先摘签名再注入。注入完的 ad-hoc 重签放在后面做。
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', staged], { stdio: 'inherit' })
  }
  try {
    execFileSync(
      process.execPath,
      [
        require.resolve('postject/dist/cli.js'),
        staged,
        'NODE_SEA_BLOB',
        BLOB,
        '--sentinel-fuse',
        SENTINEL
      ],
      { stdio: 'inherit' }
    )
  } catch (error) {
    throw explainLocked(error, staged)
  }
  // ad-hoc 重签（`-s -`）：没有开发者证书也能跑，够 CI 校验用。
  // 真分发包由 Tauri 打包时统一重签，这一步不影响它。
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--sign', '-', staged], { stdio: 'inherit' })
  }

  // 换上去：旧产物先改名挪开（跑着的 exe 只能改名，不能覆盖），失败则回滚。
  const displaced = displace(outFile)
  try {
    renameSync(staged, outFile)
  } catch (error) {
    if (displaced) {
      try {
        renameSync(displaced, outFile)
      } catch {
        // 回滚也失败：把挪走的路径告诉调用方，旧产物还能手动改回去
        console.error(`${LOG_PREFIX} 回滚失败，旧产物在 ${displaced}`)
      }
    }
    throw explainLocked(error, outFile)
  }
  if (displaced) {
    try {
      rmSync(displaced, { force: true })
    } catch {
      // 旧产物还被跑着的桌面端占着：留给下次构建的 sweepStale
    }
  }
}

function main(): void {
  const triple = hostTriple()
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const outDir = parseOutDir(process.argv)
  const outFile = path.join(outDir, `agentd-${triple}${suffix}`)

  mkdirSync(outDir, { recursive: true })
  restoreDisplaced(outFile)
  sweepStale(outDir)
  bundle()
  buildBlob()
  inject(outFile)

  const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1)
  console.log(`${LOG_PREFIX} 完成 ${outFile}（${sizeMb} MB，triple=${triple}）`)
}

main()
