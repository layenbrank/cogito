/**
 * 数据库迁移入口。
 *
 * 背景：src-tauri 已改成 Cargo workspace，`sea-orm-cli migrate …`（依赖 `-d` 定位 Cargo.toml）
 * 不再适用；这里直接跑 `crates/database` 的迁移 bin（`cogito-database`），只需给出库地址。
 *
 * 用法：
 *   pnpm --filter @cogito/client migrate:status
 *   pnpm --filter @cogito/client migrate:up
 *   pnpm --filter @cogito/client migrate:fresh
 *   pnpm --filter @cogito/client migrate down -- -n 2      # 透传额外参数
 *   node scripts/migrate.ts status --db ./tmp/dev.db           # 指向别的库
 *   node scripts/migrate.ts fresh --no-backup                  # 跳过自动备份
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(SCRIPT_DIR, '..')
const MANIFEST = path.join(CLIENT_DIR, 'src-tauri', 'Cargo.toml')
const LOG_PREFIX = '[migrate]'

/** 与 src-tauri/tauri.conf.json 的 `identifier` 一致：应用数据目录名 */
const APP_IDENTIFIER = 'com.cogito.client'
const DATABASE_FILE = 'cogito-client.db'

/** 会清空 / 回滚数据的子命令：执行前自动备份 */
const DESTRUCTIVE = new Set(['fresh', 'reset', 'refresh'])

const SUBCOMMANDS = [
  'init',
  'generate',
  'fresh',
  'refresh',
  'reset',
  'status',
  'up',
  'down'
] as const

interface Options {
  subcommand: string
  dbPath: string | null
  isBackupEnabled: boolean
  passthrough: string[]
}

/** 应用本地数据目录（与 tauri 的 app_local_data_dir 同规则） */
function findAppLocalDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, APP_IDENTIFIER)
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_IDENTIFIER)
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  return path.join(base, APP_IDENTIFIER)
}

function parseArgs(argv: string[]): Options {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1)

  let subcommand: string | null = null
  let dbPath: string | null = null
  let isBackupEnabled = true

  for (let index = 0; index < own.length; index++) {
    const arg = own[index] ?? ''
    if (arg === '--db') {
      dbPath = own[index + 1] ?? null
      index++
      continue
    }
    if (arg === '--no-backup') {
      isBackupEnabled = false
      continue
    }
    if (arg.startsWith('-')) {
      passthrough.push(arg)
      continue
    }
    subcommand = arg
  }

  return {
    subcommand: subcommand ?? 'status',
    dbPath,
    isBackupEnabled,
    passthrough
  }
}

function findDatabasePath(options: Options): string {
  if (options.dbPath) return path.resolve(CLIENT_DIR, options.dbPath)
  if (process.env.COGITO_CLIENT_DB) return path.resolve(process.env.COGITO_CLIENT_DB)
  return path.join(findAppLocalDataDir(), DATABASE_FILE)
}

function formatTimestamp(date: Date): string {
  const pad = function (value: number) {
    return String(value).padStart(2, '0')
  }
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** 破坏性操作前把库文件（含 -wal / -shm）复制一份到同目录 */
function backupDatabase(dbPath: string): void {
  if (!fs.existsSync(dbPath)) {
    console.log(`${LOG_PREFIX} 库文件尚不存在，跳过备份：${dbPath}`)
    return
  }

  const stamp = formatTimestamp(new Date())
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`
    if (!fs.existsSync(source)) continue
    const target = `${dbPath}.${stamp}.bak${suffix}`
    fs.copyFileSync(source, target)
    if (suffix === '') console.log(`${LOG_PREFIX} 已备份：${target}`)
  }
}

function run(options: Options, databaseUrl: string): number {
  const args = [
    'run',
    '--manifest-path',
    MANIFEST,
    '-p',
    'cogito-database',
    '--bin',
    'cogito-database',
    '--',
    '-u',
    databaseUrl,
    options.subcommand,
    ...options.passthrough
  ]

  const result = spawnSync('cargo', args, {
    cwd: CLIENT_DIR,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.error) {
    console.error(`${LOG_PREFIX}`, result.error)
    return 1
  }
  return result.status ?? 1
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))

  if (!(SUBCOMMANDS as readonly string[]).includes(options.subcommand)) {
    console.error(`${LOG_PREFIX} 未知子命令：${options.subcommand}`)
    console.error(`${LOG_PREFIX} 可用：${SUBCOMMANDS.join(' / ')}`)
    process.exit(1)
  }

  const dbPath = findDatabasePath(options)
  console.log(`${LOG_PREFIX} ${options.subcommand} → ${dbPath}`)

  if (DESTRUCTIVE.has(options.subcommand)) {
    console.log(`${LOG_PREFIX} 提示：请先完全退出应用，否则库可能被占用`)
    if (options.isBackupEnabled) backupDatabase(dbPath)
  }

  // 与 bootstrap 的 `sqlite:{path}?mode=rwc` 保持同一形状
  const databaseUrl = `sqlite:${dbPath}?mode=rwc`
  process.exit(run(options, databaseUrl))
}

main()
