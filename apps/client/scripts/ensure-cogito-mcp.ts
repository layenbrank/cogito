/**
 * `cogito-mcp` 是本仓自建的 MCP 侧车：它**不是** app crate 的依赖，`tauri dev` 的
 * cargo 构建不会碰它，goose 拉起的是 `src-tauri/binaries/` 里那份 stage 产物。
 *
 * 于是「改了 `crates/mcp` 但没重跑 `pnpm command sidecar stage client`」会静默降级：
 * app 一切正常，只是新会话里本地工具面只剩 `cogito_ping`，
 * instructions 报「缺少 COGITO_BRIDGE_URL / COGITO_BRIDGE_TOKEN_FILE」——
 * 表现为「审批面板永远不弹」（因为写文件/执行命令的工具根本没注册）。
 *
 * 这里在 dev 启动前比对源码与产物的 mtime：陈旧才重新 cargo build 并覆盖落盘文件，
 * 同时把 `binaries/checksums.json` 里那一条的 sha256 一起刷新，
 * 免得后续 `prepare-binaries.ts` 因为校验和不匹配而拒绝构建。
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface StagedFileEntry {
  tool: string
  version: string
  sha256: string
  onDemand?: boolean
}

/** `binaries/checksums.json`（契约见 `packages/sidecar/src/schema.ts`，这里只碰 `cogito` 一条） */
interface ChecksumsDocument {
  schemaVersion?: number
  platform?: string
  files?: Record<string, StagedFileEntry>
}

const LOG_PREFIX = '[ensure-cogito-mcp]'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(SCRIPT_DIR, '..')
const TAURI_DIR = path.join(CLIENT_DIR, 'src-tauri')
const CRATE_DIR = path.join(TAURI_DIR, 'crates', 'mcp')
const BINARIES_DIR = path.join(TAURI_DIR, 'binaries')
const CHECKSUMS_FILE = path.join(BINARIES_DIR, 'checksums.json')
const CRATE_NAME = 'cogito-mcp'
const PROFILE = process.env.COGITO_MCP_PROFILE?.trim() || 'release'

/** 当前目标的 Rust triple（与 `prepare-binaries.ts` / Tauri externalBin 命名一致）。 */
function hostTriple(): string {
  const override =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.CARGO_BUILD_TARGET?.trim()
  if (override) {
    return override
  }
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') {
    return `${arch}-pc-windows-msvc`
  }
  if (process.platform === 'darwin') {
    return `${arch}-apple-darwin`
  }
  return `${arch}-unknown-linux-gnu`
}

function stagedPath(): string {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  return path.join(BINARIES_DIR, `${CRATE_NAME}-${hostTriple()}${suffix}`)
}

/** 源码树里最新的 mtime（含 Cargo.toml）——任何一处改动都算「产物已过期」。 */
function newestSourceMtime(): number {
  let newest = 0
  const walk = function (dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'target') {
          continue
        }
        walk(full)
        continue
      }
      if (!/\.(rs|toml)$/.test(entry.name)) {
        continue
      }
      newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  walk(CRATE_DIR)
  // workspace 级的 Cargo.toml / Cargo.lock 也能改变链接结果
  for (const name of ['Cargo.toml', 'Cargo.lock']) {
    const file = path.join(TAURI_DIR, name)
    if (existsSync(file)) {
      newest = Math.max(newest, statSync(file).mtimeMs)
    }
  }
  return newest
}

/** cargo 的 target 目录（可能被 `CARGO_TARGET_DIR` 改到别处，不由 path 拼接猜）。 */
function findTargetDir(): string {
  const raw = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps', '--offline'],
    { cwd: TAURI_DIR, encoding: 'utf8' }
  )
  const meta = JSON.parse(raw) as { target_directory?: unknown }
  if (typeof meta.target_directory !== 'string') {
    throw new Error('cargo metadata 未返回 target_directory')
  }
  return meta.target_directory
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** 只改 `cogito` 那一条：其它工具的 sha256 是远端归档的事实，不能跟着动。 */
function refreshChecksums(fileName: string): void {
  if (!existsSync(CHECKSUMS_FILE)) {
    return
  }
  const payload = JSON.parse(readFileSync(CHECKSUMS_FILE, 'utf8')) as ChecksumsDocument
  if (!payload.files || typeof payload.files !== 'object') {
    return
  }
  const next: StagedFileEntry = {
    tool: 'cogito',
    version: 'local',
    sha256: sha256Of(path.join(BINARIES_DIR, fileName))
  }
  if (JSON.stringify(payload.files[fileName]) === JSON.stringify(next)) {
    return
  }
  payload.files[fileName] = next
  writeFileSync(CHECKSUMS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function main(): void {
  const dest = stagedPath()
  if (existsSync(dest) && statSync(dest).mtimeMs >= newestSourceMtime()) {
    return
  }

  console.log(`${LOG_PREFIX} crates/mcp 有改动且产物陈旧 → 重新构建 ${CRATE_NAME}（${PROFILE}）`)
  execFileSync('cargo', ['build', '-p', CRATE_NAME, '--profile', PROFILE], {
    cwd: TAURI_DIR,
    stdio: 'inherit'
  })
  const profileDir = PROFILE === 'dev' ? 'debug' : PROFILE
  const exe = process.platform === 'win32' ? `${CRATE_NAME}.exe` : CRATE_NAME
  const built = path.join(findTargetDir(), profileDir, exe)
  if (!existsSync(built)) {
    throw new Error(`${LOG_PREFIX} 构建完成却找不到产物：${built}`)
  }
  copyFileSync(built, dest)
  refreshChecksums(path.basename(dest))
  console.log(`${LOG_PREFIX} 已刷新 ${path.relative(CLIENT_DIR, dest)}`)
}

main()
